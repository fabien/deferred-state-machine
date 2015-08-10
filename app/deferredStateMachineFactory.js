define(['jquery', 'underscore'], function($, _) {

    /**
     * A finite state machine that works with deferreds.
     * FSMs are created using the factory method that this module returns.
     *
     * Since the state machine factory creates a finite state machine from a passed in
     * object, any object can be used. This includes things like Backbone Views.
     *

     */
    
    function StateMachineProxy(context) {
        this.context = context;
    };
    
    return function(obj, states, proxy) {
        var Factory = this;
        
        var factoryMethods = {
            initialState: initialState,
            getState: getState,
            getStates: getStates,
            onMethod: onMethod,
            onTransition: onTransition,
            transition: deferIt(transition),
            transitionAllowed: transitionAllowed
        };

        // Private variables
        var _onMethod = [];
        var _onTransition = [];
        var _stateNames = _.keys(states || {});
        var _allMethodNames = getMethods(obj);
        var _triggers = {}; // map methodName to stateName
        
        _.each(_stateNames, function(name) {
            if (states[name] && _.isString(states[name].trigger)) {
                _triggers[states[name].trigger] = name;
            }
        });
        
        var _initialState = _.find(_stateNames, function(name) {
            return states[name] && states[name].initial;
        });
        
        var _currentState = _initialState;
        
        // Alternatively, specify a proxy object as a receiver
        var subject = proxy ? new StateMachineProxy(obj) : obj;

        _.forEach(_allMethodNames, function(methodName) {
            var method = obj[methodName];
            if (Function !== method.constructor) {
                return;
            }

            subject[methodName] = deferIt(function(deferred) {
                var methods,
                    args = Array.prototype.slice.call(arguments),
                    transitionName = _triggers[methodName];

                if (!_currentState) {
                    deferred.reject(methodNotAllowed());
                    return;
                }

                args.shift();

                methods = states[_currentState].methods;

                if (_.isEmpty(methods) // allow when no explicit allowed methods
                    || (_.isArray(methods) && _.contains(methods, methodName))) {
                    var callbacks = _onMethod;
                    if (transitionName) {
                        // run transition, before actual method call
                        callbacks = callbacks.concat(function() {
                            return subject.transition(transitionName);
                        });
                    }
                    runSeries.apply(null, [callbacks, subject, methodName].concat(args)).done(function() {
                        whenDeferred(deferred, method.apply(obj, args));
                    }).fail(function(err) {
                        deferred.reject(err || methodNotAllowed());
                    })
                } else {
                    deferred.reject(methodNotAllowed());
                }
            }.bind(obj));
        });
        
        $.extend(subject, factoryMethods);
        
        return subject;
        
        function initialState() {
            return _initialState;
        };

        function getState() {
            return _currentState;
        }

        function getStates() {
            return _stateNames;
        }

        function transition(deferred, newState) {
            var previousState;

            if (transitionAllowed(newState)) {
                previousState = _currentState;
                _currentState = newState;
                
                var info = { from: previousState, to: newState };
                
                var exitFn = function() {};
                if (previousState && states[previousState]
                    && _.isFunction(states[previousState].exit)) {
                    exitFn = states[previousState].exit;
                }
                
                var enterFn = function() {};
                if (newState && states[newState]
                    && _.isFunction(states[newState].enter)) {
                    enterFn = states[newState].enter;
                }
                
                var callbacks = _onTransition;
                
                runSeries.apply(null, [callbacks, this, info]).done(function() {
                    return $.when(exitFn.call(obj, info)).done(function() {
                        return $.when(enterFn.call(obj, info)).done(function() {
                            deferred.resolve(info);
                        });
                    });
                }).fail(function(err) {
                    deferred.reject(err || transitionNotAllowed());
                });
            } else {
                deferred.reject(transitionNotAllowed());
            }
        }
        
        function onTransition(callback) {
            if (_.isFunction(callback)) _onTransition.push(callback);
        }

        function transitionAllowed(newState) {
            var allowed = true,
                transitions;

            if (!_currentState) {
                allowed = _.contains(_stateNames, newState);
            } else {
                transitions = states[_currentState].transitions;
                allowed = transitions && _.contains(transitions, newState);
            }
            return allowed;
        }
        
        function onMethod(callback) {
            if (_.isFunction(callback)) _onMethod.push(callback);
        }
        
        function whenDeferred(deferred, fn1, fn2) {
            var args = Array.prototype.slice.call(arguments);
            return $.when.apply($, args.slice(1)).then(function() {
                return deferred.resolve.apply(deferred, arguments);
            }, function() {
                return deferred.reject.apply(deferred, arguments);
            });
        }

        // A helper method that creates a new deferred, returns its promise and calls the method with the deferred
        function deferIt(method) {
            return function() {
                var args = Array.prototype.slice.call(arguments),
                    $deferred = $.Deferred();
                args.unshift($deferred);
                method.apply(this, args);
                return $deferred.promise();
            };
        }
        
        function getMethods(obj) {
            var res = [];
            for (var m in obj) {
                if (typeof obj[m] == 'function') {
                    res.push(m)
                }
            }
            return res;
        }
        
        function runSeries(callbacks) {
            var args = _.rest(arguments);
            var dfd = $.Deferred();
            
            var chain = _.reduce(callbacks, function(previous, cb) {
                if (!previous) return cb.apply(null, args);
                return previous.then(function() {
                    return cb.apply(null, args);
                });
            }, null);
            
            if (chain) {
                chain.then(dfd.resolve, dfd.reject);
            } else {
                dfd.resolve();
            }
            return dfd.promise();
        }
        
        // Errors
        function transitionNotAllowed() {
            return new Error('transition not allowed');
        };
        
        function methodNotAllowed() {
            return new Error('method not allowed');
        };
        

    };
});