import { performance } from 'node:perf_hooks';
import { sleep } from './utils.js';
import Timer from '#Timer.js';
import * as timerErrors from '#errors.js';

describe(Timer.name, () => {
  test('timer is thenable and awaitable', async () => {
    const t1 = new Timer();
    expect(await t1).toBeUndefined();
    expect(t1.status).toBe('settled');
    const t2 = new Timer();
    await expect(t2).resolves.toBeUndefined();
    expect(t2.status).toBe('settled');
  });
  test('timer delays', async () => {
    const t1 = new Timer({ delay: 20, handler: () => 1 });
    const t2 = new Timer(() => 2, 10);
    const result = await Promise.any([t1, t2]);
    expect(result).toBe(2);
  });
  test('timer handlers', async () => {
    const t1 = new Timer(() => 123);
    expect(await t1).toBe(123);
    expect(t1.status).toBe('settled');
    const t2 = new Timer({ delay: 100, handler: () => '123' });
    expect(await t2).toBe('123');
    expect(t2.status).toBe('settled');
  });
  test('timer timestamps', async () => {
    const start = new Date(performance.timeOrigin + performance.now());
    await sleep(10);
    const t = new Timer({ delay: 100 });
    expect(t.status).toBeNull();
    expect(t.timestamp).toBeAfter(start);
    expect(t.scheduled).toBeAfter(start);
    expect(t.scheduled).toBeAfterOrEqualTo(t.timestamp);
    const delta = t.scheduled!.getTime() - t.timestamp.getTime();
    expect(t.getTimeout()).toBeLessThanOrEqual(delta);
  });
  test('timer primitive string and number', () => {
    const t1 = new Timer();
    expect(t1.valueOf()).toBe(0);
    expect(+t1).toBe(0);
    expect(t1.toString()).toBe('0');
    expect(`${t1}`).toBe('0');
    const t2 = new Timer({ delay: 100 });
    expect(t2.valueOf()).toBePositive();
    expect(+t2).toBePositive();
    expect(t2.toString()).toMatch(/\d+/);
    expect(`${t2}`).toMatch(/\d+/);
  });
  test('timer with infinite delay', async () => {
    const t1 = new Timer({ delay: Infinity });
    expect(t1.delay).toBe(Infinity);
    expect(t1.scheduled).toBeUndefined();
    expect(t1.getTimeout()).toBe(Infinity);
    expect(t1.valueOf()).toBe(Infinity);
    expect(+t1).toBe(Infinity);
    expect(t1.toString()).toBe('Infinity');
    expect(`${t1}`).toBe('Infinity');
    t1.cancel(new Error('Oh No'));
    await expect(t1).rejects.toThrow('Oh No');
  });
  test('custom signal handler ignores default rejection', async () => {
    const onabort = jest.fn();
    const t = new Timer(
      () => 1,
      50,
      false,
      (signal) => {
        signal.onabort = onabort;
      },
    );
    t.cancel('abort');
    await expect(t).resolves.toBe(1);
    expect(onabort).toBeCalled();
  });
  test('custom abort controller ignores default rejection', async () => {
    const onabort = jest.fn();
    const abortController = new AbortController();
    abortController.signal.onabort = onabort;
    const t = new Timer(() => 1, 50, false, abortController);
    t.cancel('abort');
    await expect(t).resolves.toBe(1);
    expect(onabort).toBeCalled();
  });
  describe('timer cancellation', () => {
    test('cancellation rejects the timer with the reason', async () => {
      const t1 = new Timer(undefined, 100);
      t1.cancel();
      await expect(t1).toReject();
      expect(t1.status).toBe('settled');
      const t2 = new Timer({ delay: 100 });
      const results = await Promise.all([
        (async () => {
          try {
            await t2;
          } catch (e) {
            return e;
          }
        })(),
        (async () => {
          t2.cancel('Surprise!');
        })(),
      ]);
      expect(results[0]).toBe('Surprise!');
      expect(t2.status).toBe('settled');
    });
    test('non-lazy cancellation is early/eager rejection', async () => {
      let resolveHandlerCalledP;
      const handlerCalledP = new Promise<void>((resolve) => {
        resolveHandlerCalledP = resolve;
      });
      let p;
      const handler = jest.fn().mockImplementation((signal: AbortSignal) => {
        resolveHandlerCalledP();
        p = new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject('handler abort start');
            return;
          }
          const timeout = setTimeout(() => resolve('handler result'), 100);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject('handler abort during');
            },
            { once: true },
          );
        });
        return p;
      });
      // Non-lazy means that it will do an early rejection
      const t = new Timer({
        handler,
        delay: 100,
        lazy: false,
      });
      await handlerCalledP;
      expect(handler).toBeCalledWith(expect.any(AbortSignal));
      t.cancel('timer abort');
      await expect(t).rejects.toBe('timer abort');
      await expect(p).rejects.toBe('handler abort during');
    });
    test('lazy cancellation', async () => {
      let resolveHandlerCalledP;
      const handlerCalledP = new Promise<void>((resolve) => {
        resolveHandlerCalledP = resolve;
      });
      let p;
      const handler = jest.fn().mockImplementation((signal: AbortSignal) => {
        resolveHandlerCalledP();
        p = new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject('handler abort start');
            return;
          }
          const timeout = setTimeout(() => resolve('handler result'), 100);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject('handler abort during');
            },
            { once: true },
          );
        });
        return p;
      });
      // Lazy means that it will not do an early rejection
      const t = new Timer({
        handler,
        delay: 100,
        lazy: true,
      });
      await handlerCalledP;
      expect(handler).toBeCalledWith(expect.any(AbortSignal));
      t.cancel('timer abort');
      await expect(t).rejects.toBe('handler abort during');
      await expect(p).rejects.toBe('handler abort during');
    });
    test('cancellation should not have an unhandled promise rejection', async () => {
      const timer = new Timer();
      timer.cancel('reason');
    });
    test('multiple cancellations should have an unhandled promise rejection', async () => {
      const timer = new Timer();
      timer.cancel('reason 1');
      timer.cancel('reason 2');
    });
    test('only the first reason is used in multiple cancellations', async () => {
      const timer = new Timer();
      timer.cancel('reason 1');
      timer.cancel('reason 2');
      await expect(timer).rejects.toBe('reason 1');
    });
    test('lazy cancellation allows resolution if signal is ignored', async () => {
      const timer = new Timer({
        handler: (signal) => {
          expect(signal.aborted).toBe(true);
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve('result');
            }, 50);
          });
        },
        lazy: true,
      });
      timer.cancel('reason');
      expect(await timer).toBe('result');
    });
    test('lazy cancellation allows rejection if signal is ignored', async () => {
      const timer = new Timer({
        handler: () => {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              reject('error');
            }, 50);
          });
        },
        lazy: true,
      });
      timer.cancel('reason');
      await expect(timer).rejects.toBe('error');
    });
  });
  test('Refresh updates timer scheduled time', async () => {
    const t = new Timer({ delay: 100 });
    const scheduledTimeInitial = t.scheduled;
    await sleep(50);
    // Refresh should update the timer
    t.refresh();
    const scheduledTimeNew = t.scheduled;
    expect(scheduledTimeNew).toBeAfter(scheduledTimeInitial!);
    await t;
    // Timer can end just before the scheduled time, this is expected.
    //  Adding 5ms to account for this.
    expect(
      new Date(performance.timeOrigin + performance.now() + 5),
    ).toBeAfterOrEqualTo(scheduledTimeNew!);
  });
  test('Refresh throws error when timer has ended', async () => {
    const t = new Timer({ delay: 1 });
    await t;
    expect(() => t.refresh()).toThrowError(timerErrors.ErrorTimerEnded);
  });
  test('Reset updates timer scheduled time and delay', async () => {
    const t = new Timer({ delay: 100 });
    const scheduledTimeInitial = t.scheduled;
    await sleep(50);
    // Reset should update the timer
    t.reset(200);
    const scheduledTimeNew = t.scheduled;
    expect(t.delay).toEqual(200);
    expect(scheduledTimeNew).toBeAfter(scheduledTimeInitial!);
    expect(
      scheduledTimeNew!.getTime() - scheduledTimeInitial!.getTime(),
    ).toBeGreaterThanOrEqual(140);
    await t;
    expect(
      new Date(performance.timeOrigin + performance.now() + 5),
    ).toBeAfterOrEqualTo(scheduledTimeNew!);
  });
  test('Reset throws error when timer has ended', async () => {
    const t = new Timer({ delay: 1 });
    await t;
    expect(() => t.reset(100)).toThrowError(timerErrors.ErrorTimerEnded);
  });
});
