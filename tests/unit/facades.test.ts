import type { Timer } from '#index.js';
import { describe, expect, test } from 'vitest';
import { createTimerScope, createTimingFacades } from '#index.js';

type TimingContext = {
  trace: string;
  timer?: Timer<number>;
  signal?: AbortSignal;
};

describe('timing function and method facades', () => {
  test('CASE-TIMER-FACADE-PARITY: both forms preserve the receiver and selected arguments', async () => {
    const facades = createTimingFacades<TimingContext>()(
      createTimerScope({ delay: 0, handler: () => 7 }),
    );
    class Worker {
      constructor(readonly prefix: string) {}

      @facades.method({ context: 1 })
      async decorated(label: string, context: TimingContext, suffix: string) {
        return `${this.prefix}:${label}:${context.trace}:${await context.timer!}:${suffix}`;
      }
    }
    const functional = facades.function(
      async function (
        this: Worker,
        label: string,
        context: TimingContext,
        suffix: string,
      ) {
        return `${this.prefix}:${label}:${context.trace}:${await context.timer!}:${suffix}`;
      },
      { context: 1 },
    );
    const worker = new Worker('worker');
    const expected = 'worker:job:trace:7:done';
    expect(await worker.decorated('job', { trace: 'trace' }, 'done')).toBe(
      expected,
    );
    expect(
      await functional.call(worker, 'job', { trace: 'trace' }, 'done'),
    ).toBe(expected);
  });

  test('CASE-TIMER-FACADE-CONCURRENT: overlapping calls own distinct timers', async () => {
    const facades = createTimingFacades<TimingContext>()(
      createTimerScope<number>({ delay: Infinity }),
    );
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const seen: Timer<number>[] = [];
    const run = facades.function(
      async (context: TimingContext) => {
        seen.push(context.timer!);
        if (seen.length === 2) bothEntered();
        await gate;
        return context.trace;
      },
      { context: 'last' },
    );
    const first = run({ trace: 'first' });
    const second = run({ trace: 'second' });
    await entered;
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(seen.map((timer) => timer.status)).toEqual(['settled', 'settled']);
  });

  test('CASE-TIMER-FACADE-FAILURE: body failures retain identity', async () => {
    const facades = createTimingFacades<TimingContext>()(
      createTimerScope<number>({ delay: Infinity }),
    );
    const failure = { body: 'failed' };
    const run = facades.function(
      async (_context: TimingContext): Promise<void> => {
        throw failure;
      },
      { context: 0 },
    );
    await expect(run({ trace: 'failure' })).rejects.toBe(failure);
  });

  test('CASE-TIMER-FACADE-DRAIN: both forms propagate cancellation and drain running handlers', async () => {
    let bothStarted!: () => void;
    let finishHandlers!: () => void;
    let finishBodies!: () => void;
    const started = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    const handlers = new Promise<void>((resolve) => {
      finishHandlers = resolve;
    });
    const bodies = new Promise<void>((resolve) => {
      finishBodies = resolve;
    });
    const signals: AbortSignal[] = [];
    const facades = createTimingFacades<TimingContext>()(
      createTimerScope({
        delay: 0,
        handler: async (signal) => {
          signals.push(signal);
          if (signals.length === 2) bothStarted();
          await handlers;
          return 7;
        },
      }),
    );
    const functional = facades.function(
      async (context: TimingContext) => {
        await bodies;
        return context.trace;
      },
      { context: 'last' },
    );
    class Worker {
      @facades.method({ context: 'last' })
      async run(context: TimingContext) {
        await bodies;
        return context.trace;
      }
    }
    const parent = new AbortController();
    const reason = { stopped: true };
    let completed = 0;
    const first = functional({ trace: 'function', signal: parent.signal }).then(
      (result) => {
        completed++;
        return result;
      },
    );
    const second = new Worker()
      .run({ trace: 'method', signal: parent.signal })
      .then((result) => {
        completed++;
        return result;
      });
    await started;
    parent.abort(reason);
    expect(signals.every((signal) => signal.reason === reason)).toBe(true);
    finishBodies();
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(0);
    finishHandlers();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'function',
      'method',
    ]);
  });

  test('CASE-TIMER-FACADE-SELECTION: invalid or missing context positions fail', () => {
    const facades = createTimingFacades<TimingContext>()(
      createTimerScope<number>({ delay: Infinity }),
    );
    const operation = async (_context: TimingContext) => 1;
    const unchecked = facades.function as unknown as (
      fn: typeof operation,
      options: { context: number },
    ) => unknown;
    expect(() => unchecked(operation, { context: -1 })).toThrow(TypeError);
    const run = facades.function(operation, { context: 0 });
    expect(() => (run as unknown as () => Promise<number>)()).toThrow(
      RangeError,
    );
  });
});
