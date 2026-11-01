import { Timer, errors } from '@matrixai/timer';

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
  return {
    value,
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
