import assert from 'node:assert/strict';
import { LifecycleGate, createLifecycleEngine, createLifecycleReaderScope, createLifecycleWriterScope } from '@matrixai/async-init';
import { createCancellationScope, startCancellationGroup, completeCancellation } from '@matrixai/async-cancellable';
import { createTimerScope } from '@matrixai/timer';

function deferred() {
  let resolve;
  const promise = new Promise((resolve_) => { resolve = resolve_; });
  return { promise, resolve };
}

// CASE-PROVIDERS-LIFECYCLE-DRAIN: waiter abandonment starts timer cleanup but
// does not release real lock-backed lifecycle admission while the handler lives.
const gate = new LifecycleGate();
const read = createLifecycleReaderScope(gate);
const write = createLifecycleWriterScope(gate);
const started = deferred(), stopping = deferred(), finish = deferred();
const upstream = new AbortController();
const request = { cancelled: 'request' }, failure = { failed: 'handler' };
const events = [];
const timerScope = createTimerScope({ handler: async (signal) => {
  signal.addEventListener('abort', () => stopping.resolve(), { once: true });
  started.resolve();
  await finish.promise;
  events.push('handler-end');
  throw failure;
} });
const operation = createCancellationScope()(read(timerScope(async ({ timer, signal, lifecycle }) => {
  assert.equal(gate.currentAccess(lifecycle), 'reader');
  return timer.wait(signal);
})));
const completion = operation({ signal: upstream.signal });
const rejected = assert.rejects(completion, (error) => error.error === failure && error.suppressed === request);
await started.promise;
const writer = write(async () => { events.push('writer'); })({});
upstream.abort(request);
await stopping.promise;
assert.deepEqual(events, []);
finish.resolve();
await rejected;
await writer;
assert.deepEqual(events, ['handler-end', 'writer']);

// CASE-PROVIDERS-LIFECYCLE-RACE: an early winner remains available, but the
// provider-owned admission boundary retains an owned loser and its late failure.
const loserEntered = deferred(), loserFinish = deferred(), groupReady = deferred();
let group;
const lateFailure = { failed: 'loser' };
const admitted = read(async () => {
  group = startCancellationGroup('race', [
    async () => 7,
    async () => { loserEntered.resolve(); await loserFinish.promise; throw lateFailure; },
  ], {}, { cancelRemaining: 'on-selection' });
  groupReady.resolve();
  return completeCancellation(group);
})({});
const groupRejected = assert.rejects(admitted, (error) => error === lateFailure);
await groupReady.promise;
await loserEntered.promise;
assert.equal(await group.result, 7);
let writerEntered = false;
const after = write(async () => { writerEntered = true; })({});
await Promise.resolve();
assert.equal(writerEntered, false);
loserFinish.resolve();
await groupRejected;
await after;
assert.equal(writerEntered, true);

// CASE-PROVIDERS-LIFECYCLE-STOP: actual service stop cannot overtake an
// admitted operation's timer cleanup after its caller abandons waiting.
const serviceEvents = [];
const engine = createLifecycleEngine({}, {
  serviceId: 'packed-timer-stop',
  profile: 'start-stop',
});
await engine.start();
const handlerEntered = deferred(), handlerStopping = deferred(), handlerFinished = deferred();
const caller = new AbortController();
const abandoned = { cancelled: 'caller' };
const ownedTimer = createTimerScope({ handler: async (signal) => {
  signal.addEventListener('abort', () => handlerStopping.resolve(), { once: true });
  handlerEntered.resolve();
  await handlerFinished.promise;
  serviceEvents.push('handler-end');
  return 11;
} });
const serviceWork = engine.runOperation('timer', (lifecycle) => {
  assert.equal(engine.currentAccess(lifecycle), 'reader');
  return ownedTimer(async ({ timer }) => timer.wait(caller.signal))({});
});
const serviceRejected = assert.rejects(serviceWork, (error) => error === abandoned);
await handlerEntered.promise;
let stopped = false;
const stop = engine.stop().then(() => { stopped = true; serviceEvents.push('stopped'); });
caller.abort(abandoned);
await handlerStopping.promise;
assert.equal(stopped, false);
assert.equal(engine.snapshot().state, 'running');
handlerFinished.resolve();
await serviceRejected;
await stop;
assert.deepEqual(serviceEvents, ['handler-end', 'stopped']);
assert.equal(engine.snapshot().state, 'stopped');
await engine.dispose();
console.log('Packed providers passed: lifecycle admission and service stop retain timer cleanup and owned race losers.');
