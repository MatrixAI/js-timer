import type { ContextOperation } from '@matrixai/contexts';
import type { DeadlineContext } from '#deadline.js';
import { jest } from '@jest/globals';
import {
  Timer,
  constrainDeadline,
  createDeadlineConstraintScope,
  createDeadlineScope,
  createTimeoutScope,
  errors,
} from '#index.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => { resolve = resolve_; });
  return { promise, resolve };
}

describe('clock-aware deadline participation', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('CASE-TIMER-DEADLINE-LAWS: same-clock fixed constraints satisfy restricted minimum laws', () => {
    const clock = { now: () => 0 };
    const values = [-10, 0, 1, 20];
    for (const a of values) for (const b of values) for (const c of values) {
      const x = { clock, at: a }, y = { clock, at: b }, z = { clock, at: c };
      expect(constrainDeadline(x, x)).toEqual(x);
      expect(constrainDeadline(x, y)).toEqual(constrainDeadline(y, x));
      expect(constrainDeadline(x, constrainDeadline(y, z))).toEqual(
        constrainDeadline(constrainDeadline(x, y), z),
      );
      expect(constrainDeadline(x, y).at).toBeLessThanOrEqual(b);
    }
    expect(() => constrainDeadline({ clock, at: 1 }, { clock: { now: () => 0 }, at: 1 })).toThrow(TypeError);
    for (const at of [NaN, Infinity, -Infinity]) {
      expect(() => constrainDeadline({ clock, at })).toThrow(TypeError);
      expect(() => constrainDeadline({ clock, at: 1 }, { clock, at })).toThrow(TypeError);
    }
  });

  test('CASE-TIMER-DEADLINE-CAPTURE: pure narrowing captures values, never schedules, and preserves borrowed timers', async () => {
    jest.useFakeTimers();
    const clock = { now: () => 100 };
    const options = { clock, at: 10 };
    const constrain = createDeadlineConstraintScope(options);
    options.at = 200;
    const borrowed = new Timer({ delay: Infinity });
    const count = jest.getTimerCount();
    const work = constrain(async ({ deadline, timer }: { deadline: { at: number }; timer: Timer }) => {
      expect(Object.isFrozen(deadline)).toBe(true);
      expect(timer).toBe(borrowed);
      return deadline.at;
    });
    await expect(work({ timer: borrowed, deadline: { clock, at: 20 } })).resolves.toBe(10);
    expect(jest.getTimerCount()).toBe(count);
    expect(borrowed.status).toBeNull();
    borrowed.cancel();
  });

  test('CASE-TIMER-DEADLINE-DRAIN: expiry signals but does not complete or release active work', async () => {
    jest.useFakeTimers();
    let now = 0;
    const clock = { now: () => now };
    const entered = deferred(), finish = deferred();
    const parent = new AbortController();
    const add = jest.spyOn(parent.signal, 'addEventListener');
    const remove = jest.spyOn(parent.signal, 'removeEventListener');
    let child!: AbortSignal;
    let settled = false;
    const run = createDeadlineScope({ clock, at: 10 })(async ({ deadline, signal }) => {
      child = signal;
      expect(deadline.at).toBe(5);
      entered.resolve();
      await finish.promise;
      return 42;
    });
    const completion = run({ signal: parent.signal, deadline: { clock, at: 5 } }).then((value) => {
      settled = true;
      return value;
    });
    await entered.promise;
    now = 5;
    await jest.advanceTimersByTimeAsync(5);
    expect(child.aborted).toBe(true);
    expect(child.reason).toBeInstanceOf(errors.ErrorTimerDeadlineExceeded);
    expect(parent.signal.aborted).toBe(false);
    expect(settled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    finish.resolve();
    await expect(completion).resolves.toBe(42);
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-DEADLINE-PARENT: pre-abort and overlapping child links preserve reason identity and isolation', async () => {
    jest.useFakeTimers();
    const clock = { now: () => 0 };
    const parent = new AbortController();
    const reason = { parent: 'cancelled' };
    const entered = deferred(), finish = deferred();
    const children: Array<AbortSignal> = [];
    const remove = jest.spyOn(parent.signal, 'removeEventListener');
    const run = createDeadlineScope({ clock, at: 100 })(async ({ signal }) => {
      children.push(signal);
      if (children.length === 2) entered.resolve();
      await finish.promise;
      return signal.reason;
    });
    const a = run({ signal: parent.signal }), b = run({ signal: parent.signal });
    await entered.promise;
    expect(children[0]).not.toBe(children[1]);
    parent.abort(reason);
    expect(children.every((signal) => signal.aborted && signal.reason === reason)).toBe(true);
    finish.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual([reason, reason]);
    expect(remove).toHaveBeenCalledTimes(2);
    await expect(createDeadlineScope({ clock, at: 100 })(async ({ signal }) => {
      expect(signal).not.toBe(parent.signal);
      return signal.reason;
    })({ signal: parent.signal })).resolves.toBe(reason);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-DEADLINE-CLEANUP: body/setup failures remove parent links and preserve rejection identity', async () => {
    jest.useFakeTimers();
    const parent = new AbortController();
    const remove = jest.spyOn(parent.signal, 'removeEventListener');
    const reason = { failed: 'body' };
    await expect(createDeadlineScope({ clock: { now: () => 0 }, at: 100 })(async () => {
      throw reason;
    })({ signal: parent.signal })).rejects.toBe(reason);
    expect(remove).toHaveBeenCalledTimes(1);
    let bodyCalled = false;
    const clockFailure = { failed: 'clock' };
    await expect(createDeadlineScope({ clock: { now: () => { throw clockFailure; } }, at: 100 })(async () => {
      bodyCalled = true;
    })({ signal: parent.signal })).rejects.toBe(clockFailure);
    expect(bodyCalled).toBe(false);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-DEADLINE-WAKEUP: early host wakeups recheck the clock instead of aborting prematurely', async () => {
    jest.useFakeTimers();
    let now = 0;
    const entered = deferred(), finish = deferred();
    let child!: AbortSignal;
    const completion = createDeadlineScope({ clock: { now: () => now }, at: 5 })(async ({ signal }) => {
      child = signal;
      entered.resolve();
      await finish.promise;
    })({});
    await entered.promise;
    now = 2;
    await jest.advanceTimersByTimeAsync(5);
    expect(child.aborted).toBe(false);
    now = 5;
    await jest.advanceTimersByTimeAsync(3);
    expect(child.aborted).toBe(true);
    finish.resolve();
    await completion;
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-DEADLINE-SETUP-SUPPRESSION: unlink failure does not replace acquisition failure', async () => {
    jest.useFakeTimers();
    const parent = new AbortController();
    const primary = { failed: 'clock acquisition' };
    const cleanup = { failed: 'unlink' };
    const remove = parent.signal.removeEventListener.bind(parent.signal);
    jest.spyOn(parent.signal, 'removeEventListener').mockImplementation((...args) => {
      remove(...args);
      throw cleanup;
    });
    const body = jest.fn(async () => 1);
    const outcome = createDeadlineScope({ clock: { now: () => { throw primary; } }, at: 10 })(body)(
      { signal: parent.signal },
    );
    await expect(outcome).rejects.toMatchObject({ error: cleanup, suppressed: primary });
    expect(body).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-DEADLINE-MONITOR-SUPPRESSION: body, monitor, and unlink failures remain observable', async () => {
    jest.useFakeTimers();
    const parent = new AbortController();
    const entered = deferred(), finish = deferred();
    const primary = { failed: 'body' };
    const monitor = { failed: 'clock wakeup' };
    const cleanup = { failed: 'unlink' };
    let reads = 0;
    const clock = { now: () => { if (++reads > 1) throw monitor; return 0; } };
    const remove = parent.signal.removeEventListener.bind(parent.signal);
    jest.spyOn(parent.signal, 'removeEventListener').mockImplementation((...args) => {
      remove(...args);
      throw cleanup;
    });
    let effective!: AbortSignal;
    const outcome = createDeadlineScope({ clock, at: 1 })(async ({ signal }) => {
      effective = signal;
      entered.resolve();
      await finish.promise;
      throw primary;
    })({ signal: parent.signal });
    const rejected = expect(outcome).rejects.toMatchObject({
      suppressed: primary,
      error: { error: cleanup, suppressed: monitor },
    });
    await entered.promise;
    await jest.advanceTimersByTimeAsync(1);
    expect(effective.reason).toBe(monitor);
    finish.resolve();
    await rejected;
    expect(parent.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('CASE-TIMER-TIMEOUT-ORDER: total and per-attempt budgets differ, but inherited bounds never widen', async () => {
    jest.useFakeTimers();
    let now = 0;
    const clock = { now: () => now };
    const timeout = createTimeoutScope({ clock, duration: 10 });
    const retry = <C, A>(body: ContextOperation<C, A>): ContextOperation<C, A> => async (ctx) => {
      try { return await body(ctx); } catch { now += 4; return body(ctx); }
    };
    async function execute(total: boolean, parentAt?: number) {
      const seen: Array<number> = [];
      const work: ContextOperation<DeadlineContext, number> = async ({ deadline }) => {
        seen.push(deadline.at);
        if (seen.length === 1) throw new Error('retry');
        return deadline.at;
      };
      const run = total ? timeout(retry(work)) : retry(timeout(work));
      await run(parentAt == null ? {} : { deadline: { clock, at: parentAt } });
      return seen;
    }
    expect(await execute(true)).toEqual([10, 10]);
    now = 0;
    expect(await execute(false)).toEqual([10, 14]);
    now = 0;
    expect(await execute(false, 7)).toEqual([7, 7]);
    now = 20;
    await expect(timeout(async ({ deadline, signal }) => {
      expect(signal.aborted).toBe(true);
      return deadline.at;
    })({ deadline: { clock, at: 7 } })).resolves.toBe(7);
    expect(jest.getTimerCount()).toBe(0);
    for (const duration of [-1, Infinity, NaN]) {
      expect(() => createTimeoutScope({ clock, duration })).toThrow(RangeError);
    }
  });
});
