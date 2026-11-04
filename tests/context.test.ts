import type { ContextOperation } from '@matrixai/contexts';
import type { TimerContext } from '#context.js';
import { bracketResource, createContextScope } from '@matrixai/contexts';
import { createTimerScope, Timer } from '#index.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => { resolve = resolve_; });
  return { promise, resolve };
}

describe('provider-owned context scope', () => {
  test('CASE-TIMER-CONTEXT-COMPOSE: direct composition preserves requirements and isolates overlapping ownership', async () => {
    const bothEntered = deferred();
    const finish = deferred();
    const seen: Array<Timer<void>> = [];
    const events: Array<string> = [];
    const provide = createTimerScope({ delay: Infinity });
    const transaction = createContextScope<object, { transaction: string }>(
      async (_outer, body) => bracketResource(
        () => { events.push('acquire'); return 'transaction'; },
        (value) => body({ transaction: value }),
        () => { events.push('release'); },
      ),
    );
    const body: ContextOperation<
      TimerContext & { transaction: string; trace: string }, string
    > = async ({ timer, transaction, trace }) => {
      seen.push(timer);
      expect(timer.signal.aborted).toBe(false);
      if (seen.length === 2) bothEntered.resolve();
      await finish.promise;
      expect(timer.status).toBeNull();
      return `${transaction}:${trace}`;
    };
    const operation: ContextOperation<{ trace: string }, string> = transaction(provide(body));
    expect(seen).toHaveLength(0);
    expect(events).toEqual([]);
    const a = operation({ trace: 'a' });
    const b = operation({ trace: 'b' });
    await bothEntered.promise;
    expect(seen[0]).not.toBe(seen[1]);
    expect(events).toEqual(['acquire', 'acquire']);
    finish.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual(['transaction:a', 'transaction:b']);
    expect(seen.map((timer) => timer.status)).toEqual(['settled', 'settled']);
    expect(events).toEqual(['acquire', 'acquire', 'release', 'release']);
  });

  test('CASE-TIMER-CONTEXT-PENDING: release cancels unused scheduling and preserves arbitrary body rejection', async () => {
    const reason = { body: 'failed' };
    let owned!: Timer<void>;
    const operation = createTimerScope({ delay: Infinity })(async ({ timer }) => {
      owned = timer;
      throw reason;
    });
    await expect(operation({})).rejects.toBe(reason);
    expect(owned.status).toBe('settled');
    await expect(Promise.resolve(owned)).rejects.toEqual(expect.any(Symbol));
  });

  test('CASE-TIMER-CONTEXT-DRAIN: cancellation requests do not release a running handler or its outer resource', async () => {
    const started = deferred();
    const cancelled = deferred();
    const finish = deferred();
    const events: Array<string> = [];
    const provide = createTimerScope({
      delay: 0,
      handler: async (signal) => {
        events.push('handler');
        signal.addEventListener('abort', () => {
          events.push('abort');
          cancelled.resolve();
        }, { once: true });
        started.resolve();
        await finish.promise;
        events.push('handler-complete');
        return 7;
      },
    });
    const run = provide(async ({ timer }) => {
      await started.promise;
      timer.cancel('application request');
      events.push('body-complete');
      return 42;
    });
    let settled = false;
    const completion = bracketResource(
      () => { events.push('acquire'); return {}; },
      () => run({}),
      () => { events.push('release'); },
    ).then((value) => { settled = true; return value; });
    await cancelled.promise;
    expect(settled).toBe(false);
    expect(events).not.toContain('release');
    finish.resolve();
    await expect(completion).resolves.toBe(42);
    expect(events).toEqual([
      'acquire', 'handler', 'abort', 'body-complete', 'handler-complete', 'release',
    ]);
  });

  test('CASE-TIMER-CONTEXT-FAILURES: handler failure is observed and distinct body failure is suppressed, not lost', async () => {
    const started = deferred();
    const finish = deferred();
    const handlerFailure = { handler: 'failed' };
    const bodyFailure = { body: 'failed' };
    const provide = createTimerScope({
      delay: 0,
      handler: async () => {
        started.resolve();
        await finish.promise;
        throw handlerFailure;
      },
    });
    const completion = provide(async () => {
      await started.promise;
      finish.resolve();
      throw bodyFailure;
    })({});
    await expect(completion).rejects.toMatchObject({
      name: 'SuppressedError', error: handlerFailure, suppressed: bodyFailure,
    });
  });

  test('CASE-TIMER-CONTEXT-OBSERVED: awaiting a failed handler preserves that exact failure once', async () => {
    const reason = { handler: 'failed' };
    const provide = createTimerScope({ delay: 0, handler: () => { throw reason; } });
    await expect(provide(async ({ timer }) => await timer)({})).rejects.toBe(reason);
  });

  test('CASE-TIMER-CONTEXT-UNOBSERVED: a handler failure cannot disappear behind a successful body', async () => {
    const finished = deferred();
    const reason = { handler: 'failed' };
    const provide = createTimerScope({
      delay: 0,
      handler: () => { finished.resolve(); throw reason; },
    });
    await expect(provide(async () => { await finished.promise; return 42; })({})).rejects.toBe(reason);
  });
});
