import { Timer, createTimerScope, createDeadlineScope, errors } from '@matrixai/timer';
import { startCancellationGroup, completeCancellation } from '@matrixai/async-cancellable';

async function run() {
  const timer = new Timer((signal) => (signal.aborted ? -1 : 7), 1);
  const timestamp = timer.timestamp.getTime();
  const value = await timer;
  const reset = new Timer(() => 9, Infinity);
  const infinite = reset.getTimeout() === Infinity && reset.scheduled == null;
  reset.reset(5);
  reset.refresh();
  const remaining = reset.getTimeout();
  const resetValue = await reset;
  const pending = new Timer({ delay: Infinity });
  pending.cancel('cancelled');
  let cancelled = false;
  try {
    await pending;
  } catch (reason) {
    cancelled = reason === 'cancelled';
  }
  let ended = false;
  try {
    timer.refresh();
  } catch (error) {
    ended = error instanceof errors.ErrorTimerEnded;
  }
  const scoped = createTimerScope({ delay: 0, handler: () => 11 });
  const scopeValue = await scoped(async ({ timer, trace }) => `${trace}:${await timer}`)({ trace: 'browser' });
  const parent = new AbortController();
  const deadlineExpired = await createDeadlineScope({ clock: { now: () => 1 }, at: 0 })(
    async ({ signal }) => signal.aborted && signal.reason instanceof errors.ErrorTimerDeadlineExceeded,
  )({ signal: parent.signal });
  let start, finish;
  const started = new Promise((resolve) => { start = resolve; });
  const finishing = new Promise((resolve) => { finish = resolve; });
  const active = new Timer(async () => { start(); await finishing; return 13; });
  await started;
  const waiter = new AbortController();
  const waiting = active.wait(waiter.signal);
  waiter.abort('leave');
  let waiterIsolated = false;
  try { await waiting; } catch (reason) {
    waiterIsolated = reason === 'leave' && !active.signal.aborted && active.status === 'settling';
  }
  active.cancel('request');
  const retainedExecution = active.status === 'settling';
  finish();
  const completed = await active.completion;
  const actualCompleted = retainedExecution && completed.status === 'fulfilled' && completed.value === 13;
  const group = startCancellationGroup('all', [
    async () => await new Timer(() => 2),
    async () => await new Timer(() => 3),
  ], {});
  const groupValue = (await completeCancellation(group)).join(',');
  return {
    value,
    scopeValue,
    deadlineExpired: deadlineExpired && !parent.signal.aborted,
    waiterIsolated,
    actualCompleted,
    groupValue,
    resetValue,
    infinite,
    cancelled,
    ended,
    timestamp,
    monotonic: reset.timestamp.getTime() >= timestamp,
    remaining: remaining >= 0 && remaining <= 5,
    settled: timer.status === 'settled' && timer.getTimeout() === 0,
  };
}

function publish(result) {
  if (typeof globalThis.document === 'object') globalThis.timerResult = result;
  else globalThis.postMessage(result);
}

run().then(publish, (error) => publish({ error: String(error) }));
