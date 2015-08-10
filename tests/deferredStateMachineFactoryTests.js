/*global describe:false, it:false, beforeEach:false*/
define(['chai', 'squire', 'mocha', 'sinon', 'sinonChai'], function (chai, Squire, mocha, sinon, sinonChai) {

    'use strict';
    var injector = new Squire(),
        should = chai.should();

    require(['sinonCall', 'sinonSpy']);
    // Using Sinon-Chai assertions for spies etc. https://github.com/domenic/sinon-chai
    chai.use(sinonChai);
    mocha.setup('bdd');
    mocha.stacktrace = true;
    mocha.slow(1000);
    
    var events = [];
    
    function Player() {};
    
    Player.prototype.play = function() {
        console.log('play');
    };
    
    Player.prototype.pause = function() {
        console.log('pause');
    };
    
    Player.prototype.stop = function() {
        console.log('stop');
    };

    describe('The Deferred State Machine Factory', function() {
        var FSMFactory,
            stateMachine,
            obj,
            states,
            methodNames = [
                'walkThrough',
                'lock',
                'openDoor',
                'closeDoor',
                'kickDown'
            ];

        beforeEach(function(done) {
            
            events = [];
            
            obj = {
                    walkThrough: function() {},
                    lock: function() {},
                    unlock: function() {},
                    openDoor: function() { console.log('openDoor'); },
                    closeDoor: function() {;
                        return delay(50, 42);
                    },
                    kickDown: function() {}
            };

            states = {
                open: {
                    enter: function(transition) {
                        events.push('enter:open');
                        return delay(50);
                    },
                    exit: function(transition) {
                        events.push('exit:open');
                        return delay(50);
                    },
                    methods: [
                       'walkThrough', 'closeDoor'
                    ],
                    transitions: [
                        'shut'
                    ]
                },
                shut: {
                    enter: function(transition) {
                        events.push('enter:shut');
                        return delay(50);
                    },
                    methods: [
                        'lock', 'openDoor'
                    ],
                    transitions: [
                        'open', 'destroyed'
                    ]
                },
                locked: {
                    methods: [
                        'unlock', 'kickDown'
                    ],
                    transitions: [
                        'shut', 'destroyed'
                    ]
                },
                destroyed: {
                    // End state
                }
            };

            injector.require(['deferredStateMachineFactory'], function (factory) {
                    stateMachine = factory(obj, states);
                    FSMFactory = factory;
                    done();
                },
                function () {
                    console.log('Squire error.');
                });
        });

        it('doesn\'t create a global if amd is present', function() {
            should.exist(window.define);
            should.exist(window.define.amd);
            should.not.exist(window.deferredStateMachineFactory);
        });


        it('returns an object that is the original object', function() {
            stateMachine.should.equal(obj);
        });
        
        it('should return a proxy object (optionally)', function(done) {            
            var player = new Player();
            
            var fsm = new FSMFactory(player, {
                'playing': {
                    trigger: 'play',
                    methods: ['pause', 'stop'],
                    transitions: ['paused', 'stopped']
                },
                'paused':{
                    trigger: 'pause',
                    methods: ['play', 'stop'],
                    transitions: ['playing', 'stopped']
                },
                'stopped':{
                    trigger: 'stop',
                    initial: true,
                    methods: ['play'],
                    transitions: ['playing']
                }
            }, true); // return proxy
            
            fsm.should.not.equal(player);
            fsm.context.should.equal(player);
            
            fsm.play.should.be.a.function;
            fsm.play.should.not.equal(player.play);
            
            fsm.getState().should.equal('stopped');
            
            fsm.onMethod(onMethodFn(1));
            fsm.onMethod(onMethodFn(2));
            
            fsm.onTransition(onTransitionFn(1));
            fsm.onTransition(onTransitionFn(2));
            
            var expected = [
                'm:play:1', 'm:play:2',
                't:stopped:playing:1', 't:stopped:playing:2',
                'm:pause:1', 'm:pause:2', 't:playing:paused:1',
                't:playing:paused:2',
                'm:stop:1', 'm:stop:2',
                't:paused:stopped:1', 't:paused:stopped:2'
            ];
            
            fsm.play().then(function() {
                fsm.getState().should.equal('playing');
            }).then(fsm.pause).then(function() {
                fsm.getState().should.equal('paused');
            }).then(fsm.stop).then(function() {
                fsm.getState().should.equal('stopped');
            }).then(function() {
                events.should.eql(expected);
            }).then(done);
        });

        describe('returns an FSM. The Deferred State Machine', function() {
            describe('getStates method', function() {
                it('return an array of string representing the states in the passed in config', function() {
                    stateMachine.getStates().should.deep.equal([
                        'open', 'shut', 'locked', 'destroyed'
                    ]);
                });
                it('should correctly return the states of one FSM after a second one is created', function() {
                    var fsm2;

                    fsm2 = new FSMFactory({}, {
                        'play': {},
                        'pause':{}
                    });
                    fsm2.getStates().should.deep.equal(['play', 'pause']);
                    stateMachine.getStates().should.deep.equal([
                        'open', 'shut', 'locked', 'destroyed'
                    ]);
                });
            });

            describe('getState method', function() {
                it('returns "undefined" after FSM initializiation', function() {
                    should.not.exist(stateMachine.getState());
                });
            });

            describe('transition method', function() {
                it('returns a promise', function() {
                    var transitionPromise = stateMachine.transition();
                    isAPromise(transitionPromise);
                });
                it('correctly changes the state of the FSM after a successful transition', function(done) {
                    sinon.spy(states.open, 'enter');
                    sinon.spy(states.open, 'exit');
                    sinon.spy(states.shut, 'enter');
                    
                    stateMachine.transition('open').done(function() {
                        stateMachine.getState().should.equal('open');
                        states.open.enter.should.have.been.calledOnce;
                        events.should.eql(['enter:open']);
                        stateMachine.transition('shut').done(function() {
                            stateMachine.getState().should.equal('shut');
                            states.open.exit.should.have.been.calledOnce;
                            states.shut.enter.should.have.been.calledOnce;
                            events.should.eql(['enter:open', 'exit:open', 'enter:shut']);
                            done();
                        });
                    });
                });
                it('does not change the state of the FSM after a failed transition to a disallowed state', function(done) {
                    stateMachine.transition('open').always(function() {
                        events.should.eql(['enter:open']);
                        stateMachine.transition('locked').fail(function() {
                            stateMachine.getState().should.equal('open');
                            events.should.eql(['enter:open']);
                            done();
                        });
                    });
                });
                it('does not change the state of the FSM after a failed transition', function(done) {
                    stateMachine.transition('blargh').fail(function() {
                        should.not.exist(stateMachine.getState());
                        done();
                    });
                });
            });

            describe('methods described in the state options', function() {
                it('all return promises', function() {
                    $.each(methodNames, function(index, method) {
                        isAPromise(stateMachine[method]());
                    });
                });
                it('fail if they are not available in the current state', function(done) {
                     stateMachine.openDoor().fail(function() {
                         // cannot use done directly, since the fail is called with a string
                         done();
                     });
                });
                it('resolve if they are available in the current state', function(done) {
                    stateMachine.transition('open').done(function() {
                        stateMachine.closeDoor('now').done(function() {
                            done();
                        });
                    });
                });
                it('resolve with their return values', function(done) {
                    stateMachine.transition('open').done(function() {
                        stateMachine.closeDoor().done(function(returned) {
                            returned.should.equal(42);
                            done();
                        });
                    });
                });
                it('are called with the correct arguments', function(done) {
                    sinon.spy(obj, 'closeDoor');

                    stateMachine.transition('open').done(function() {
                        stateMachine.closeDoor(1, 2, 3).done(function() {
                            obj.closeDoor.should.have.been.calledOnce;
                            obj.closeDoor.should.have.been.calledWithExactly(1,2,3);
                            done();
                        });
                    });
                });
                // Add test for arguments to methods and method calls after transitions
            });
        });
    });

    function delay(ms, value) {
        var dfd = $.Deferred();
        setTimeout(function() {
            dfd.resolve(value);
        }, ms || 100);
        return dfd.promise();
    };
    
    function onMethodFn(id) {
        return function(fsm, methodName) {
            events.push('m:' + methodName + ':' + id);
            return delay(50);
        };
    };
    
    function onTransitionFn(id) {
        return function(fsm, info) {
            events.push('t:' + info.from + ':' + info.to + ':' + id);
            return delay(50);
        };
    };

    function isAPromise(promise) {
        var testFor, testAgainst;

        should.exist(promise);

        testFor = [promise.done, promise.fail, promise.progress, promise.then];
        testAgainst = [promise.resolve, promise.reject];

        $.each(testFor, function(index, method) {
            should.exist(method);
            method.should.be.a.Function;
        });
        $.each(testAgainst, function(index, method) {
            should.not.exist(method);
        });
    };
});