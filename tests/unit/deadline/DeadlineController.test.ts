import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CancellationController } from '@matrixai/async-cancellable';
import { DeadlineController, errors, timerClock } from '#index.js';

describe('independently owned deadline controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('is a native cancellation controller with a stable signal', () => {
    const controller = new DeadlineController({ duration: 100 });
    expect(controller).toBeInstanceOf(CancellationController);
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal).toBeInstanceOf(AbortSignal);
    expect(controller.signal).toBe(controller.signal);
    controller.close();
  });

  test('captures one shared fixed budget and requests rather than completing work', async () => {
    let now = 10;
    const clock = { now: () => now };
    const parent = { clock, at: 30 };
    const controller = new DeadlineController({
      duration: 100,
      clock,
      parentDeadline: parent,
    });
    parent.at = 500;
    expect(controller.deadline).toEqual({ clock, at: 30 });
    expect(Object.isFrozen(controller.deadline)).toBe(true);
    expect(controller.monitoringState.status).toBe('pending');
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let completed = false;
    const observed = work.then(() => {
      completed = true;
    });
    now = 30;
    vi.advanceTimersByTime(20);
    expect(controller.signal.reason).toBeInstanceOf(
      errors.ErrorTimerDeadlineExceeded,
    );
    expect(completed).toBe(false);
    expect(await controller.monitoring).toEqual({
      status: 'fulfilled',
      value: undefined,
    });
    finish();
    await observed;
    controller.close();
  });

  test('rechecks early wakeups without restarting the bound', async () => {
    let now = 0;
    const controller = new DeadlineController({
      duration: 10,
      clock: { now: () => now },
    });
    vi.advanceTimersByTime(10);
    expect(controller.signal.aborted).toBe(false);
    now = 10;
    vi.advanceTimersByTime(10);
    expect(controller.signal.aborted).toBe(true);
    expect((await controller.monitoring).status).toBe('fulfilled');
    controller.close();
  });

  test('synthetic abort events do not stop deadline monitoring', async () => {
    let now = 0;
    const controller = new DeadlineController({
      duration: 10,
      clock: { now: () => now },
    });
    controller.signal.dispatchEvent(new Event('abort'));
    expect(controller.signal.aborted).toBe(false);
    expect(controller.monitoringState.status).toBe('pending');
    now = 10;
    vi.advanceTimersByTime(10);
    expect(controller.signal.reason).toBeInstanceOf(
      errors.ErrorTimerDeadlineExceeded,
    );
    expect((await controller.monitoring).status).toBe('fulfilled');
    controller.close();
  });

  test('CASE-CONTROLLER-FANOUT: shared negotiation budget permits loser cancellation and explicit winner handoff', async () => {
    let now = 0;
    const controller = new DeadlineController({
      duration: 5,
      clock: { now: () => now },
    });
    const loser = new CancellationController(controller.signal);
    const winner = new CancellationController();
    const detachWinner = winner.link(controller.signal);
    let finishLoser!: () => void;
    const loserCompletion = new Promise<void>((resolve) => {
      finishLoser = resolve;
    });
    let loserFinished = false;
    const observedLoser = loserCompletion.then(() => {
      loserFinished = true;
    });
    const reason = { superseded: true };
    loser.abort(reason);
    expect(loser.signal.reason).toBe(reason);
    expect(controller.signal.aborted).toBe(false);
    expect(winner.signal.aborted).toBe(false);
    expect(loserFinished).toBe(false);
    detachWinner();
    now = 3;
    const late = new CancellationController(controller.signal);
    expect(controller.deadline.at).toBe(5);
    finishLoser();
    await observedLoser;
    now = 5;
    vi.advanceTimersByTime(5);
    expect(late.signal.reason).toBeInstanceOf(
      errors.ErrorTimerDeadlineExceeded,
    );
    expect(winner.signal.aborted).toBe(false);
    loser.close();
    late.close();
    controller.close();
    winner.close();
    expect((await controller.monitoring).status).toBe('fulfilled');
  });

  test('validates constraints and clock identity before linking', () => {
    const clock = { now: () => 2 };
    const parent = new AbortController();
    const add = vi.spyOn(parent.signal, 'addEventListener');
    expect(
      () =>
        new DeadlineController({ duration: -1, clock, signal: parent.signal }),
    ).toThrow();
    expect(
      () => new DeadlineController({ duration: Infinity, clock }),
    ).toThrow();
    expect(
      () =>
        new DeadlineController({
          duration: 1,
          clock,
          parentDeadline: { clock: { now: () => 2 }, at: 3 },
          signal: parent.signal,
        }),
    ).toThrow();
    expect(
      () => new DeadlineController({ deadline: { clock, at: Infinity } }),
    ).toThrow();
    expect(
      () => new DeadlineController({ duration: 1, clock: { now: () => NaN } }),
    ).toThrow();
    expect(add).not.toHaveBeenCalled();
    const shared = new DeadlineController({ duration: 10 });
    expect(shared.deadline.clock).toBe(timerClock);
    shared.close();
  });

  test('pre-aborted upstream wins over an expired deadline', async () => {
    const parent = new AbortController();
    const reason = { source: 'parent' };
    parent.abort(reason);
    const controller = new DeadlineController({
      deadline: { clock: { now: () => 10 }, at: 1 },
      signal: parent.signal,
    });
    expect(controller.signal.reason).toBe(reason);
    expect((await controller.monitoring).status).toBe('fulfilled');
    controller.close();
  });

  test('expiry keeps parent links owned until explicit close', () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    let now = 0;
    const controller = new DeadlineController({
      duration: 1,
      clock: { now: () => now },
      signal: parent.signal,
    });
    now = 1;
    vi.advanceTimersByTime(1);
    expect(controller.signal.reason).toBeInstanceOf(
      errors.ErrorTimerDeadlineExceeded,
    );
    expect(remove).not.toHaveBeenCalled();
    controller.close();
    expect(remove).toHaveBeenCalledOnce();
  });

  test('dynamic links are directional, independently detachable and retain exact reasons', () => {
    const parent = new AbortController();
    const sibling = new AbortController();
    const controller = new DeadlineController({ duration: 100 });
    const detachFirst = controller.link(parent.signal);
    const detachSecond = controller.link(parent.signal);
    controller.link(sibling.signal);
    detachFirst();
    const reason = { source: 'parent' };
    parent.abort(reason);
    expect(controller.signal.reason).toBe(reason);
    expect(sibling.signal.aborted).toBe(false);
    detachSecond();
    controller.close();
  });

  test('close stops enforcement without aborting, permits local abort and rejects links', async () => {
    const parent = new AbortController();
    const controller = new DeadlineController({
      duration: 10,
      signal: parent.signal,
    });
    controller.close();
    parent.abort('upstream');
    vi.advanceTimersByTime(20);
    expect(controller.signal.aborted).toBe(false);
    expect(await controller.monitoring).toBe(controller.monitoringState);
    expect(Object.isFrozen(controller.monitoringState)).toBe(true);
    expect(() => controller.link(parent.signal)).toThrow();
    controller.abort('local');
    expect(controller.signal.reason).toBe('local');
    controller.close();
  });

  test('monitor failures retain identity and request cancellation', async () => {
    const failure = new Error('clock failed');
    let reads = 0;
    const controller = new DeadlineController({
      duration: 1,
      clock: {
        now: () => {
          if (++reads > 1) throw failure;
          return 0;
        },
      },
    });
    vi.advanceTimersByTime(1);
    expect(controller.signal.reason).toBe(failure);
    expect(await controller.monitoring).toEqual({
      status: 'rejected',
      reason: failure,
    });
    controller.close();
  });

  test('scheduler replacement failures request cancellation and remain observable', async () => {
    const failure = new Error('schedule failed');
    const controller = new DeadlineController({
      duration: 1,
      clock: { now: () => 0 },
    });
    vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(() => {
      throw failure;
    });
    vi.advanceTimersByTime(1);
    expect(controller.signal.reason).toBe(failure);
    expect(await controller.monitoring).toEqual({
      status: 'rejected',
      reason: failure,
    });
    controller.close();
  });

  test('reentrant close retains a later monitor failure and invalidates scheduling', async () => {
    const failure = new Error('late clock failure');
    let reads = 0;
    const controller: DeadlineController = new DeadlineController({
      duration: 1,
      clock: {
        now: () => {
          if (++reads === 1) return 0;
          controller.close();
          expect(controller.monitoringState.status).toBe('pending');
          throw failure;
        },
      },
    });
    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(false);
    expect(await controller.monitoring).toEqual({
      status: 'rejected',
      reason: failure,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('failed scheduler removal is logically invalidated and retryable', async () => {
    const failure = new Error('clear failed');
    const controller = new DeadlineController({ duration: 10 });
    const clear = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => controller.close()).toThrow(failure);
    expect((await controller.monitoring).status).toBe('fulfilled');
    controller.close();
    expect(clear).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(20);
    expect(controller.signal.aborted).toBe(false);
  });

  test('abort cleanup failure is observed separately and remains retryable', async () => {
    const failure = new Error('abort clear failed');
    const controller = new DeadlineController({ duration: 10 });
    vi.spyOn(globalThis, 'clearTimeout').mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => controller.abort('stop')).not.toThrow();
    expect(await controller.monitoring).toEqual({
      status: 'rejected',
      reason: failure,
    });
    controller.close();
    expect(controller.signal.reason).toBe('stop');
  });

  test('failed unlink is retryable and upstream cannot forward after close begins', () => {
    const parent = new AbortController();
    const failure = new Error('unlink failed');
    const controller = new DeadlineController({
      duration: 10,
      signal: parent.signal,
    });
    const remove = vi
      .spyOn(parent.signal, 'removeEventListener')
      .mockImplementationOnce(() => {
        parent.abort('late');
        throw failure;
      });
    expect(() => controller.close()).toThrow(failure);
    expect(controller.signal.aborted).toBe(false);
    controller.close();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  test('retains peer cleanup failures even when they have the same value', () => {
    const parent = new AbortController();
    const failure = new Error('cleanup failed');
    const controller = new DeadlineController({
      duration: 10,
      signal: parent.signal,
    });
    vi.spyOn(parent.signal, 'removeEventListener').mockImplementationOnce(
      () => {
        throw failure;
      },
    );
    vi.spyOn(globalThis, 'clearTimeout').mockImplementationOnce(() => {
      throw failure;
    });
    let result: unknown;
    try {
      controller.close();
    } catch (reason) {
      result = reason;
    }
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toEqual([failure, failure]);
    controller.close();
  });

  test('unwinds a partially installed upstream link when acquisition fails', () => {
    const parent = new AbortController();
    const failure = new Error('install failed');
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const add = parent.signal.addEventListener.bind(parent.signal);
    vi.spyOn(parent.signal, 'addEventListener').mockImplementationOnce(
      (...args) => {
        add(...args);
        throw failure;
      },
    );
    expect(
      () => new DeadlineController({ duration: 10, signal: parent.signal }),
    ).toThrow(failure);
    expect(remove).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
