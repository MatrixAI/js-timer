import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Timer from '#Timer.js';
import { ErrorTimerEnded } from '#errors.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => {
    resolve = resolve_;
  });
  return { promise, resolve };
}

describe('Timer scheduling and execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  test('CASE-TIMER-SCHEDULE: overloads execute in scheduled order with native chains', async () => {
    const first = new Timer(() => 2, 10);
    const second = new Timer({ delay: 20, handler: () => 1 });
    const empty = new Timer();
    const winner = Promise.race([first, second]);
    const chained = first.then((value) => value + 1);
    expect(chained).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.resolve(empty)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    await expect(winner).resolves.toBe(2);
    await expect(chained).resolves.toBe(3);
    expect(second.status).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    await expect(Promise.resolve(second)).resolves.toBe(1);
    expect(first.status).toBe('settled');
  });

  test.each([NaN, -1, -Infinity, 0, 10, 2 ** 31, Infinity])(
    'CASE-TIMER-NORMALIZE: construction and reset normalize %s consistently',
    async (delay) => {
      const expected = Number.isNaN(delay)
        ? 0
        : Math.min(Math.max(delay, 0), 2 ** 31 - 1);
      const normalized = delay === Infinity ? Infinity : expected;
      const constructed = new Timer({ delay });
      const reset = new Timer({ delay: Infinity });
      reset.reset(delay);
      expect(constructed.delay).toBe(normalized);
      expect(reset.delay).toBe(normalized);
      for (const timer of [constructed, reset]) {
        expect(timer.getTimeout()).toBeGreaterThanOrEqual(0);
        if (delay === Infinity) {
          expect(timer.scheduled).toBeUndefined();
          expect(+timer).toBe(Infinity);
          expect(`${timer}`).toBe('Infinity');
        }
        timer.cancel('finished');
        await expect(Promise.resolve(timer)).rejects.toBe('finished');
      }
    },
  );

  test('CASE-TIMER-REFRESH: reset and refresh replace one owned host handle', async () => {
    const handler = vi.fn(() => 4);
    const timer = new Timer({ delay: 10, handler });
    const scheduled = timer.scheduled!;
    scheduled.setTime(0);
    expect(timer.scheduled!.getTime()).not.toBe(0);
    timer.reset(Infinity);
    expect(timer.scheduled).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    timer.reset(10);
    timer.refresh();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    await expect(Promise.resolve(timer)).resolves.toBe(4);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(timer.getTimeout()).toBe(0);
    expect(+timer).toBe(0);
    expect(`${timer}`).toBe('0');
    expect(() => timer.refresh()).toThrow(ErrorTimerEnded);
    expect(() => timer.reset(1)).toThrow(ErrorTimerEnded);
  });

  test('CASE-TIMER-SCHEDULE-RACE: a queued superseded wakeup cannot enter the handler', async () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const handler = vi.fn(() => 7);
    const timer = new Timer({ delay: 10, handler });
    const stale = schedule.mock.calls[0][0];
    timer.reset(20);
    expect(typeof stale).toBe('function');
    if (typeof stale === 'function') stale();
    expect(handler).not.toHaveBeenCalled();
    expect(timer.status).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    await expect(Promise.resolve(timer)).resolves.toBe(7);
    expect(handler).toHaveBeenCalledTimes(1);
    schedule.mockRestore();
  });

  test('CASE-TIMER-RESET-FAILURE: failed replacement settles and retains cleanup authority', async () => {
    const timer = new Timer({ delay: Infinity });
    const failure = { failed: 'clear during reset' };
    const clear = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => {
        throw failure;
      });
    expect(() => timer.reset(10)).toThrow(failure);
    await expect(timer.completion).resolves.toMatchObject({
      status: 'rejected',
      reason: failure,
    });
    clear.mockRestore();
    timer.retryCleanup();

    const second = new Timer({ delay: Infinity });
    const schedule = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(() => {
        throw failure;
      });
    expect(() => second.reset(10)).toThrow(failure);
    await expect(second.completion).resolves.toMatchObject({
      status: 'rejected',
      reason: failure,
    });
    schedule.mockRestore();
  });

  test('CASE-TIMER-RESET-REENTRANT: cancellation during clearing prevents replacement', async () => {
    const timer = new Timer({ delay: 10 });
    const clear = globalThis.clearTimeout;
    const spy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementationOnce((handle) => {
        timer.cancel('reentrant');
        clear(handle);
      });
    timer.reset(20);
    await expect(Promise.resolve(timer)).rejects.toBe('reentrant');
    expect(vi.getTimerCount()).toBe(0);
    spy.mockRestore();
  });

  test('CASE-TIMER-UPSTREAM: parent requests are directional and links outlive running work', async () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const finish = deferred<number>();
    const timer = new Timer({
      signal: parent.signal,
      handler: () => finish.promise,
    });
    await vi.advanceTimersByTimeAsync(0);
    const reason = { cancelled: 'parent' };
    parent.abort(reason);
    expect(timer.signal.reason).toBe(reason);
    expect(remove).not.toHaveBeenCalled();
    finish.resolve(8);
    await expect(Promise.resolve(timer)).resolves.toBe(8);
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRestore();

    const already = new Timer({ signal: parent.signal, delay: 10 });
    await expect(Promise.resolve(already)).rejects.toBe(reason);
    const otherParent = new AbortController();
    const child = new Timer({ signal: otherParent.signal, delay: Infinity });
    child.cancel('local');
    expect(otherParent.signal.aborted).toBe(false);
    await expect(Promise.resolve(child)).rejects.toBe('local');
  });

  test('CASE-TIMER-LINK-FAILURE: cleanup failures retain the primary reason and can be retried', async () => {
    const parent = new AbortController();
    const originalRemove = parent.signal.removeEventListener.bind(
      parent.signal,
    );
    const cleanup = { failed: 'unlink' };
    const remove = vi
      .spyOn(parent.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw cleanup;
      });
    const timer = new Timer({ signal: parent.signal, delay: Infinity });
    const reason = { cancelled: 'parent' };
    parent.abort(reason);
    const outcome = await timer.completion;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({
        error: cleanup,
        suppressed: reason,
      });
      await expect(Promise.resolve(timer)).rejects.toBe(outcome.reason);
    }
    remove.mockImplementation(originalRemove);
    timer.retryCleanup();
    expect(remove).toHaveBeenCalledTimes(2);
    remove.mockRestore();
  });

  test('CASE-TIMER-SETUP-FAILURE: a failed upstream link unwinds the host handle', () => {
    const parent = new AbortController();
    const failure = { failed: 'link' };
    const add = vi
      .spyOn(parent.signal, 'addEventListener')
      .mockImplementation(() => {
        throw failure;
      });
    let thrown: unknown;
    try {
      new Timer({ signal: parent.signal, delay: Infinity });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    add.mockRestore();
  });

  test('CASE-TIMER-CLEANUP-FAILURE: scheduler cleanup failure is retained and retryable', async () => {
    const timer = new Timer({ delay: Infinity });
    const cleanup = { failed: 'clear' };
    const reason = { cancelled: true };
    const clear = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => {
        throw cleanup;
      });
    timer.cancel(reason);
    const outcome = await timer.completion;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatchObject({
        error: cleanup,
        suppressed: reason,
      });
      await expect(Promise.resolve(timer)).rejects.toBe(outcome.reason);
    }
    clear.mockRestore();
    timer.retryCleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([null, 0, '', { cancelled: true }])(
    'CASE-TIMER-PENDING: pending cancellation preserves the first exact reason %s',
    async (reason) => {
      const handler = vi.fn(() => 1);
      const timer = new Timer({ delay: Infinity, handler });
      timer.signal.addEventListener('abort', () => {});
      timer.cancel(reason);
      timer.cancel('replacement');
      expect(timer.signal.reason).toBe(reason);
      expect(timer.status).toBe('settled');
      await expect(Promise.resolve(timer)).rejects.toBe(reason);
      await expect(timer.completion).resolves.toEqual({
        status: 'rejected',
        reason,
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  test('CASE-TIMER-NATIVE-ABORT: omitted reason uses native AbortError, not an error rewrite', async () => {
    const timer = new Timer({ delay: Infinity });
    timer.cancel();
    expect(timer.signal.reason).toBeInstanceOf(DOMException);
    expect(timer.signal.reason.name).toBe('AbortError');
    await expect(Promise.resolve(timer)).rejects.toBe(timer.signal.reason);
  });

  test('CASE-TIMER-RUNNING: a noncooperative handler retains execution until fulfillment', async () => {
    const finish = deferred<number>();
    const timer = new Timer(() => finish.promise);
    let completed = false;
    void timer.completion.then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(timer.status).toBe('settling');
    timer.cancel('request');
    expect(timer.signal.reason).toBe('request');
    expect(completed).toBe(false);
    expect(() => timer.reset(1)).toThrow(ErrorTimerEnded);
    finish.resolve(7);
    await expect(Promise.resolve(timer)).resolves.toBe(7);
    await expect(timer.completion).resolves.toEqual({
      status: 'fulfilled',
      value: 7,
    });
    timer.cancel('too late');
    expect(timer.signal.reason).toBe('request');
  });

  test('CASE-TIMER-COOPERATION: a cooperative handler controls its cancellation outcome', async () => {
    const timer = new Timer(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const waiting = Promise.resolve(timer);
    const reason = { request: true };
    const rejected = expect(waiting).rejects.toBe(reason);
    timer.cancel(reason);
    await rejected;
    expect(timer.status).toBe('settled');
  });

  test('CASE-TIMER-BORROWED-WAIT: preaborted and concurrent waiters never gain source authority', async () => {
    const timer = new Timer(() => 9, 10);
    const waiter = new AbortController();
    waiter.abort(0);
    await expect(timer.wait(waiter.signal)).rejects.toBe(0);
    expect(timer.signal.aborted).toBe(false);
    const retained = timer.wait();
    await vi.advanceTimersByTimeAsync(10);
    await expect(retained).resolves.toBe(9);
    expect(timer.signal.aborted).toBe(false);
    timer.cancel('settled');
    expect(timer.signal.aborted).toBe(false);
  });
});
