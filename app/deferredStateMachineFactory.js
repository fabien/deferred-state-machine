define(['jquery', 'underscore', 'backbone'], function($, _, Backbone) {
    
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
    
    _.extend(StateMachineProxy.prototype, Backbone.Events);
    
    return function(obj, states, proxy) {
        var Factory = this;
        
        var setState = deferIt(transition);
        
        var factoryMethods = {
            initialState: initialState,
            setState: setState,
            getState: getState,
            getStates: getStates,
            getStateTransitions: getStateTransitions,
            getStateMethods: getStateMethods,
            getStateData: getStateData,
            onMethod: onMethod,
            onTransition: onTransition,
            onFailure: onFailure,
            transition: setState,
            transitionAllowed: transitionAllowed
        };

        // Private variables
        var _onEnter = {};
        var _onExit = {};
        var _onMethod = [];
        var _onTransition = [];
        var _onFailure = [];
        var _stateNames = _.keys(states || {});
        var _allMethodNames = getMethods(obj);
        var _triggers = {}; // map methodName to stateName
        
        _.each(_stateNames, function(name) {
            if (states[name] && _.isString(states[name].trigger)) {
                _triggers[states[name].trigger] = name;
            }
            _onEnter[name] = getCallbacks(obj, name, 'enter');
            _onExit[name] = getCallbacks(obj, name, 'exit');
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
            } else if (methodName === 'trigger') {
                return; // prevent
            }

            subject[methodName] = deferIt(function(deferred) {
                var methods,
                    args = Array.prototype.slice.call(arguments),
                    transitionName = _triggers[methodName];

                if (!_currentState) {
                    deferred.reject(methodNotAllowed(methodName));
                    return;
                }

                args.shift();

                methods = states[_currentState].methods;
                
                triggerEvents(deferred, 'exec', subject, methodName);

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
                        deferred.reject(err || methodNotAllowed(methodName));
                    })
                } else {
                    deferred.reject(methodNotAllowed(methodName));
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
        
        function getStateTransitions(stateName) {
            stateName = stateName || _currentState;
            if (stateName && states[stateName]
                && _.isArray(states[stateName].transitions)) {
                return states[stateName].transitions;
            } else {
                return _.without(_.keys(states), stateName);
            }
        }
        
        function getStateMethods(stateName) {
            stateName = stateName || _currentState;
            if (stateName && states[stateName]
                && _.isArray(states[stateName].methods)) {
                return states[stateName].methods;
            } else {
                return getMethods(obj);
            }
        }
        
        function getStateData(stateName) {
            stateName = stateName || _currentState;
            if (stateName && states[stateName]) {
                var data = states[stateName].data;
                if (_.isFunction(data)) {
                    return _.extend({}, data.call(obj, this, stateName));
                } else if (_.isObject(data)) {
                    return _.extend({}, data);
                } else if (_.isString(data)
                    && _.isFunction(obj[data])) {
                    return obj[data](this, stateName);
                } else {
                    return {};
                }
            } else {
                return {};
            }
        }
        
        function transition(deferred, newState, force) {
            var previousState;
            var self = this;
            
            if (transitionAllowed(newState) 
                || (force && newState !== _currentState)) {
                previousState = _currentState;
                _currentState = newState;
                
                var info = { from: previousState, to: newState };
                info.transitions = this.getStateTransitions();
                info.methods = this.getStateMethods();
                info.data = this.getStateData();
                
                triggerEvents(deferred, 'transition', this, info);
                
                var onEnter = _onEnter[newState] || [];
                var onExit = previousState ? _onExit[previousState] : [];
                
                return runSeries(_onTransition, self, info).done(function() {
                    return runSeries(onExit, info).done(function() {
                        return runSeries(onEnter, info).done(function() {
                            deferred.resolve(info);
                        });
                    });
                }).fail(function(err) {
                    var callbacks = [resetTransition].concat(_onFailure || []);
                    return runSeries(callbacks, self, info).always(function() {
                        deferred.reject(err || transitionNotAllowed(newState));
                    });
                });
            } else {
                deferred.reject(transitionNotAllowed(newState));
            }
        }
        
        function onTransition(callback) {
            if (_.isFunction(callback)) _onTransition.push(callback);
        }
        
        function onFailure(callback) {
            if (_.isFunction(callback)) _onFailure.push(callback);
        }
        
        function resetTransition(fsm, info) {
            return info.from && fsm.transition(info.from, true);
        }

        function transitionAllowed(newState) {
            var allowed = true,
                transitions;

            if (!_currentState) {
                allowed = _.contains(_stateNames, newState);
            } else if (_currentState === newState) {
                allowed = false;
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
        
        function triggerEvents(deferred, type, context) {
            if (context && _.isFunction(context.trigger)) {
                var args = _.rest(arguments, 3);
                deferred.done(function() {
                    context.trigger.apply(context, [type].concat(args));
                });
                deferred.fail(function() {
                    context.trigger.apply(context, [type + ':fail'].concat(args));
                });
            }
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
        
        function getCallbacks(obj, state, type) {
            var callbacks = [];
            if (state && states[state]) {
                var specs = [].concat(states[state][type] || []);
                _.each(specs, function(spec) {
                    if (_.isString(spec) && _.isFunction(obj[spec])) {
                        callbacks.push(obj[spec].bind(obj));
                    } else if (_.isFunction(spec)) {
                        callbacks.push(spec.bind(obj));
                    }
                });
            }
            return callbacks;
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
        function transitionNotAllowed(name) {
            return new Error('Transition "' + name + '" not allowed.');
        };
        
        function methodNotAllowed(name) {
            return new Error('Method "' + name + '" not allowed.');
        };
        
    };
});