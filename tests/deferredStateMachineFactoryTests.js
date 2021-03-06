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
    
    function Player() {
        this.history = [];
    };
    
    Player.prototype.play = function() {
        console.log('play');
    };
    
    Player.prototype.pause = function() {
        console.log('pause');
    };
    
    Player.prototype.stop = function() {
        console.log('stop');
    };
    
    Player.prototype.getData = function(fsm, stateName) {
        if (stateName !== 'stopped') return {};
        return { title: 'Stopped' };
    };
    
    Player.prototype.onTransition = function(transition) {
        this.history.push('onTransition');
    };
    
    Player.prototype.onPlaying = function(transition) {
        this.history.push('onPlaying');
    };
    
    Player.prototype.onPlayingToPaused = function(transition) {
        this.history.push('onPlayingToPaused');
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
                kickDown: function() {},
                onExit: function(info) {
                    events.push('exit');
                    return delay(50);
                },
                onExitOpen: function(info) {
                    events.push('exit:open');
                    return delay(50);
                }
            };

            states = {
                open: {
                    enter: function(info) {
                        events.push('enter:open');
                        return delay(50);
                    },
                    exit: ['onExit', 'onExitOpen'],
                    methods: [
                       'walkThrough', 'closeDoor'
                    ],
                    transitions: [
                        'shut'
                    ]
                },
                shut: {
                    enter: [function(transition) {
                        events.push('enter:shut');
                        return delay(50);
                    }],
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
            var fsmEvents = [];
            var failed;
            var context;
            
            var states = {
                playing: {
                    trigger: 'play',
                    methods: ['pause', 'stop'],
                    transitions: ['paused', 'stopped'],
                    data: { title: 'Playing' }
                },
                paused: {
                    trigger: 'pause',
                    methods: ['play', 'stop'],
                    transitions: ['playing', 'stopped'],
                    data: function(fsm, stateName) {
                        return { title: 'Paused' };
                    }
                },
                stopped: {
                    initial: true,
                    trigger: 'stop',
                    methods: ['play'],
                    transitions: ['playing'],
                    data: 'getData'
                }
            };
            
            var fsm = new FSMFactory(player, states, { 
                proxy: true, apply: true
            });
            
            fsm.on('all', function(eventName, arg) {
                if (eventName === 'exec') {
                    fsmEvents.push('exec:' + arg);
                } else if (eventName === 'transition') {
                    fsmEvents.push(arg.from + ':' + arg.to);
                }
            });
            
            fsm.should.not.equal(player);
            fsm.context.should.equal(player);
            
            fsm.play.should.be.a.function;
            fsm.play.should.not.equal(player.play);
            
            fsm.getState().should.equal('stopped');
            
            fsm.onMethod(onMethodFn(1));
            fsm.onMethod(onMethodFn(2));
            
            fsm.onTransition(onTransitionFn(1));
            fsm.onTransition(onTransitionFn(2));
            
            fsm.onFailure(function(fsm, info) {
                context = info.context;
                failed = info.from + ':' + info.to;
            });
            
            var expected = [
                'm:play:1', 'm:play:2',
                't:stopped:playing:1', 't:stopped:playing:2',
                'm:pause:1', 'm:pause:2', 't:playing:paused:1',
                't:playing:paused:2',
                'm:stop:1', 'm:stop:2',
                't:paused:stopped:1', 't:paused:stopped:2'
            ];
            
            var history = [
                'onPlaying', 'onTransition', 'onPlayingToPaused', 'onTransition'
            ];
            
            fsm.getStates().should.eql(['playing', 'paused', 'stopped']);
            fsm.getStates(true).should.equal(states);
            
            fsm.getState('playing').should.eql(states.playing);
            
            fsm.play().then(function() {
                fsm.hasState('playing').should.be.true;
                fsm.getState().should.equal('playing');
                fsm.getState(true).should.eql(states.playing);
                fsm.getStateTransitions().should.eql(['paused', 'stopped']);
                fsm.getStateMethods().should.eql(['pause', 'stop']);
                fsm.getStateData().should.eql({ title: 'Playing' });
            }).then(fsm.pause).then(function() {
                fsm.hasState('paused').should.be.true;
                fsm.getState().should.equal('paused');
                fsm.getStateTransitions().should.eql(['playing', 'stopped']);
                fsm.getStateMethods().should.eql(['play', 'stop']);
                fsm.getStateData().should.eql({ title: 'Paused' });
                player.history.should.eql(history);
            }).then(fsm.stop).then(function() {
                fsm.getState().should.equal('stopped');
                fsm.getStateTransitions().should.eql(['playing']);
                fsm.getStateMethods().should.eql(['play']);
                fsm.getStateData().should.eql({ title: 'Stopped' });
            }).then(function() {
                events.should.eql(expected);
            }).then(function() {
                fsmEvents.should.eql([
                    'stopped:playing', 'exec:play',
                    'playing:paused', 'exec:pause',
                    'paused:stopped', 'exec:stop'
                ]);
            }).then(function() {
                fsm.onTransition(rejectTransition('playing'));
                return fsm.transition('playing');
            }).always(function() {
                fsm.getState().should.equal('stopped');
                failed.should.equal('stopped:playing');
                context.should.equal(player);
                done();
            });
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
                    stateMachine.transition('open').done(function() {
                        stateMachine.getState().should.equal('open');
                        events.should.eql(['enter:open']);
                        stateMachine.transition('shut').done(function() {
                            stateMachine.getState().should.equal('shut');
                            events.should.eql(['enter:open', 'exit', 'exit:open', 'enter:shut']);
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
    
    function rejectTransition(stateName) {
        return function(fsm, transition) {
            if (stateName !== transition.to) return;
            return $.Deferred().reject().promise();
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