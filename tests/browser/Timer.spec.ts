import type * as TimerModule from '@matrixai/timer';
import { expect, test } from './fixture.js';
import { browserRealms } from './utils.js';

for (const realm of browserRealms) {
  test(`schedules and owns timer execution in a ${realm}`, async ({
    browserScenario,
  }) => {
    const result = await browserScenario(
      realm,
      async (library: typeof TimerModule) => {
        const { Timer, errors } = library;
        const timer = new Timer<number>(
          (signal) => (signal.aborted ? -1 : 7),
          1,
        );
        const value = await timer;
        const reset = new Timer(() => 9, Infinity);
        const infinite =
          reset.getTimeout() === Infinity && reset.scheduled == null;
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
        let start!: () => void;
        let finish!: () => void;
        const started = new Promise<void>((resolve) => {
          start = resolve;
        });
        const finishing = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const active = new Timer(async () => {
          start();
          await finishing;
          return 13;
        });
        await started;
        const waiter = new AbortController();
        const waiting = active.wait(waiter.signal);
        waiter.abort('leave');
        let waiterIsolated = false;
        try {
          await waiting;
        } catch (reason) {
          waiterIsolated =
            reason === 'leave' &&
            !active.signal.aborted &&
            active.status === 'settling';
        }
        active.cancel('request');
        const retainedExecution = active.status === 'settling';
        finish();
        const completed = await active.completion;
        const actualCompleted =
          retainedExecution &&
          completed.status === 'fulfilled' &&
          completed.value === 13;
        const upstream = new AbortController();
        const linked = new Timer({ delay: Infinity, signal: upstream.signal });
        upstream.abort('upstream');
        const linkedOutcome = await linked.completion;
        return {
          value,
          resetValue,
          infinite,
          cancelled,
          ended,
          remaining: remaining >= 0 && remaining <= 5,
          settled: timer.status === 'settled' && timer.getTimeout() === 0,
          waiterIsolated,
          actualCompleted,
          linked:
            linkedOutcome.status === 'rejected' &&
            linkedOutcome.reason === 'upstream',
        };
      },
    );
    expect(result.value).toBe(7);
    expect(result.resetValue).toBe(9);
    expect(result.infinite).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.ended).toBe(true);
    expect(result.remaining).toBe(true);
    expect(result.settled).toBe(true);
    expect(result.waiterIsolated).toBe(true);
    expect(result.actualCompleted).toBe(true);
    expect(result.linked).toBe(true);
  });
}
