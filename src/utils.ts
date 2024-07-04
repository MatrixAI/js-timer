import type { TimerRef } from './types';

function setTimerRef(
  type: 'timeout' | 'interval',
  cb: () => void,
  ms: number | undefined,
  ...args: any[]
): TimerRef {
  let ref: NodeJS.Timer | number;
  if (type === 'timeout') {
    ref = setTimeout(cb, ms, ...args);
  } else {
    ref = setTimeout(cb, ms, ...args);
  }
  return {
    ref,
    ms,
    type,
    cb,
  };
}

function clearTimerRef({ ref, type }: TimerRef) {
  if (type === 'timeout') {
    clearTimeout(ref);
  } else {
    clearInterval(ref);
  }
}

/**
 * Sets the timer's start time to the current time, and reschedules the timer to call its callback at the previously specified duration adjusted to the current time. This is useful for refreshing a timer without allocating a new JavaScript object.
 * Using this on a timer that has already called its callback will reactivate the timer.
 */
function refreshTimerRef(timerRef: TimerRef): TimerRef {
  if (typeof timerRef.ref === 'object' && 'refresh' in timerRef.ref) {
    timerRef.ref.refresh();
    return timerRef;
  }
  clearTimerRef(timerRef);
  const { ref: newRef } = setTimerRef(timerRef.type, timerRef.cb, timerRef.ms);
  timerRef.ref = newRef;
  return timerRef;
}

export { setTimerRef, clearTimerRef, refreshTimerRef };
