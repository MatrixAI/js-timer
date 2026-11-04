import { jest } from '@jest/globals';
import Timer from '#Timer.js';
import { ErrorTimerEnded } from '#errors.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => { resolve = resolve_; });
  return { promise, resolve };
}

describe('Timer scheduling and execution', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  test('CASE-TIMER-SCHEDULE: overloads execute in scheduled order with native chains', async () => {
    const first = new Timer(() => 2, 10);
    const second = new Timer({ delay: 20, handler: () => 1 });
    const empty = new Timer();
    const winner = Promise.race([first, second]);
    const chained = first.then((value) => value + 1);
    expect(chained).toBeInstanceOf(Promise);
    await jest.advanceTimersByTimeAsync(0);
    await expect(Promise.resolve(empty)).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(10);
    await expect(winner).resolves.toBe(2);
    await expect(chained).resolves.toBe(3);
    expect(second.status).toBeNull();
    await jest.advanceTimersByTimeAsync(10);
    await expect(Promise.resolve(second)).resolves.toBe(1);
    expect(first.status).toBe('settled');
  });

  test.each([NaN, -1, -Infinity, 0, 10, 2 ** 31, Infinity])(
    'CASE-TIMER-NORMALIZE: construction and reset normalize %s consistently',
    async (delay) => {
      const expected = Number.isNaN(delay) ? 0 : Math.min(Math.max(delay, 0), 2 ** 31 - 1);
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
    const handler = jest.fn(() => 4);
    const timer = new Timer({ delay: 10, handler });
    const scheduled = timer.scheduled!;
    scheduled.setTime(0);
    expect(timer.scheduled!.getTime()).not.toBe(0);
    timer.reset(Infinity);
    expect(timer.scheduled).toBeUndefined();
    expect(jest.getTimerCount()).toBe(1);
    timer.reset(10);
    timer.refresh();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(10);
    await expect(Promise.resolve(timer)).resolves.toBe(4);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(timer.getTimeout()).toBe(0);
    expect(+timer).toBe(0);
    expect(`${timer}`).toBe('0');
    expect(() => timer.refresh()).toThrow(ErrorTimerEnded);
    expect(() => timer.reset(1)).toThrow(ErrorTimerEnded);
  });

  test.each([null, 0, '', { cancelled: true }])(
    'CASE-TIMER-PENDING: pending cancellation preserves the first exact reason %s',
    async (reason) => {
      const handler = jest.fn(() => 1);
      const timer = new Timer({ delay: Infinity, handler });
      timer.signal.addEventListener('abort', () => {});
      timer.cancel(reason);
      timer.cancel('replacement');
      expect(timer.signal.reason).toBe(reason);
      expect(timer.status).toBe('settled');
      await expect(Promise.resolve(timer)).rejects.toBe(reason);
      await expect(timer.completion).resolves.toEqual({ status: 'rejected', reason });
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
    void timer.completion.then(() => { completed = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(timer.status).toBe('settling');
    timer.cancel('request');
    expect(timer.signal.reason).toBe('request');
    expect(completed).toBe(false);
    expect(() => timer.reset(1)).toThrow(ErrorTimerEnded);
    finish.resolve(7);
    await expect(Promise.resolve(timer)).resolves.toBe(7);
    await expect(timer.completion).resolves.toEqual({ status: 'fulfilled', value: 7 });
    timer.cancel('too late');
    expect(timer.signal.reason).toBe('request');
  });

  test('CASE-TIMER-COOPERATION: a cooperative handler controls its cancellation outcome', async () => {
    const timer = new Timer((signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await jest.advanceTimersByTimeAsync(0);
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
    await jest.advanceTimersByTimeAsync(10);
    await expect(retained).resolves.toBe(9);
    expect(timer.signal.aborted).toBe(false);
    timer.cancel('settled');
    expect(timer.signal.aborted).toBe(false);
  });
});
