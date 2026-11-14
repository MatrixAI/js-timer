import type { ContextDeadlineConstraint } from '@matrixai/contexts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PromiseCancellable } from '@matrixai/async-cancellable';
import { errors, timerClock } from '#index.js';
import { timed, timedCancellable } from '#functions/index.js';
import {
  timed as timedMethod,
  timedCancellable as cancellableMethod,
} from '#decorators/index.js';

type Request = {
  trace: string;
  signal?: AbortSignal;
  deadline?: ContextDeadlineConstraint;
  timer?: object;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => {
    resolve = resolve_;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('named timing authoring forms', () => {
  test('async function and standard method preserve receiver, context, and inherited bounds', async () => {
    const clock = { now: () => 10 };
    const seen: Request[] = [];
    async function run(this: { prefix: string }, id: string, context: Request) {
      seen.push(context);
      return `${this.prefix}:${id}:${context.trace}`;
    }
    const fn = timed(run, { context: 1, kind: 'async', duration: 50, clock });
    class Service {
      readonly prefix = 'method';
      @timedMethod({ context: 1, kind: 'async', duration: 50, clock })
      async run(id: string, context: Request) {
        return run.call(this, id, context);
      }
    }
    const parent = new AbortController();
    const borrowed = {};
    const context = {
      trace: 'trace',
      signal: parent.signal,
      deadline: { clock, at: 30 },
      timer: borrowed,
    };
    await expect(fn.call({ prefix: 'function' }, 'a', context)).resolves.toBe(
      'function:a:trace',
    );
    await expect(new Service().run('b', context)).resolves.toBe(
      'method:b:trace',
    );
    for (const item of seen) {
      expect(item.signal).not.toBe(parent.signal);
      expect(item.deadline?.at).toBe(30);
      expect(item.timer).toBe(borrowed);
    }
    expect(parent.signal.aborted).toBe(false);
  });

  test('sync result and failures stay synchronous; expired entry supplies an aborted signal', () => {
    const reason = { failure: true };
    const run = timed(
      (context: Request) => {
        expect(context.signal?.aborted).toBe(true);
        expect(context.signal?.reason).toBeInstanceOf(
          errors.ErrorTimerDeadlineExceeded,
        );
        return context.trace;
      },
      { context: 0, kind: 'sync', duration: 0 },
    );
    expect(run({ trace: 'value' })).toBe('value');
    class Service {
      @timedMethod({ context: 0, kind: 'sync', duration: 0 })
      run(_context: Request): never {
        throw reason;
      }
    }
    let thrown: unknown;
    try {
      new Service().run({ trace: 'value' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(reason);
  });

  test('async expiry requests cancellation without settling a gated body', async () => {
    vi.useFakeTimers();
    let now = 10;
    const clock = { now: () => now };
    const entered = deferred();
    const gate = deferred();
    const borrowed = {};
    let child!: AbortSignal;
    const run = timed(
      async (context: Request) => {
        child = context.signal!;
        expect(context.timer).toBe(borrowed);
        entered.resolve();
        await gate.promise;
        return 'finished';
      },
      { context: 0, kind: 'async', duration: 25, clock },
    );
    const parent = new AbortController();
    const result = run({
      trace: 'gate',
      signal: parent.signal,
      timer: borrowed,
    });
    await entered.promise;
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    now = 35;
    await vi.advanceTimersByTimeAsync(25);
    expect(child.reason).toBeInstanceOf(errors.ErrorTimerDeadlineExceeded);
    expect(parent.signal.aborted).toBe(false);
    expect(settled).toBe(false);
    gate.resolve();
    await expect(result).resolves.toBe('finished');
  });

  test('plain timing returns a native promise even when a widened body is cancellable', async () => {
    function source(_context: Request): Promise<number> {
      return PromiseCancellable.resolve(42);
    }
    const result = timed(source, { context: 0, kind: 'async', duration: 5000 })(
      { trace: 'value' },
    );
    expect(result).toBeInstanceOf(Promise);
    expect(result).not.toBeInstanceOf(PromiseCancellable);
    await expect(result).resolves.toBe(42);
  });

  test('method duration is evaluated for each receiver at entry', () => {
    const durations: number[] = [];
    class Service {
      constructor(readonly duration: number) {}
      @timedMethod({
        context: 0,
        kind: 'sync',
        duration(this: Service) {
          durations.push(this.duration);
          return this.duration;
        },
      })
      read(context: Request): string {
        return context.trace;
      }
    }
    expect(new Service(10).read({ trace: 'first' })).toBe('first');
    expect(new Service(20).read({ trace: 'second' })).toBe('second');
    expect(durations).toEqual([10, 20]);
  });

  test('synchronous generator acquires lazily and retains ownership through yielded cleanup', () => {
    vi.useFakeTimers();
    const settings = vi.fn(() => 100);
    let seen!: AbortSignal;
    function* source(context: Request): Generator<string, string, string> {
      seen = context.signal!;
      try {
        yield 'body';
      } finally {
        yield 'cleanup';
      }
      return 'done';
    }
    const run = timed(source, {
      context: 0,
      kind: 'generator',
      duration: settings,
    });
    const skipped = run({ trace: 'unused' });
    expect(skipped.return('closed')).toEqual({ done: true, value: 'closed' });
    expect(settings).not.toHaveBeenCalled();
    const iterator = run({ trace: 'value' });
    expect(iterator.next()).toEqual({ done: false, value: 'body' });
    expect(iterator.return('closed')).toEqual({
      done: false,
      value: 'cleanup',
    });
    vi.advanceTimersByTime(100);
    expect(seen.aborted).toBe(true);
    expect(iterator.next()).toEqual({ done: true, value: 'closed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('synchronous generator delegates next and throw and releases on terminal completion', () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    function* source(_context: Request): Generator<string, string, string> {
      const input = yield 'ready';
      try {
        yield input;
      } catch (reason) {
        yield `caught:${String(reason)}`;
      }
      return 'complete';
    }
    const run = timed(source, { context: 0, kind: 'generator', duration: 100 });
    const iterator = run({ trace: 'x', signal: parent.signal });
    expect(iterator.next()).toEqual({ done: false, value: 'ready' });
    expect(iterator.next('input')).toEqual({ done: false, value: 'input' });
    expect(iterator.throw('problem')).toEqual({
      done: false,
      value: 'caught:problem',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(iterator.next()).toEqual({ done: true, value: 'complete' });
    expect(remove).toHaveBeenCalled();
    remove.mockRestore();
  });

  test('synchronous generator preserves source and link cleanup failures', () => {
    const parent = new AbortController();
    const primary = { role: 'source' };
    const cleanup = { role: 'unlink' };
    const remove = vi
      .spyOn(parent.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw cleanup;
      });
    function* source(_context: Request): Generator<string> {
      yield 'ready';
      throw primary;
    }
    const iterator = timed(source, {
      context: 0,
      kind: 'generator',
      duration: 100,
    })({ trace: 'x', signal: parent.signal });
    expect(iterator.next().value).toBe('ready');
    let failure: unknown;
    try {
      iterator.next();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SuppressedError);
    expect((failure as SuppressedError).error).toBe(cleanup);
    expect((failure as SuppressedError).suppressed).toBe(primary);
    remove.mockRestore();
  });

  test('async generator rejects overlapping advancement without closing the source', async () => {
    const gate = deferred();
    const started = deferred();
    async function* source(
      _context: Request,
    ): AsyncGenerator<string, string, void> {
      started.resolve();
      await gate.promise;
      yield 'first';
      return 'done';
    }
    const run = timed(source, {
      context: 0,
      kind: 'async-generator',
      duration: 5_000,
    });
    const iterator = run({ trace: 'value' });
    const first = iterator.next();
    await started.promise;
    await expect(iterator.next()).rejects.toThrow(TypeError);
    gate.resolve();
    await expect(first).resolves.toEqual({ done: false, value: 'first' });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: 'done',
    });
  });

  test('method generators share lazy ownership and explicitly finish yielded cleanup', async () => {
    vi.useFakeTimers();
    const settings = vi.fn(() => 50);
    class Service {
      @timedMethod({ context: 0, kind: 'generator', duration: settings })
      *rows(_context: Request): Generator<string, void, void> {
        try {
          yield 'row';
        } finally {
          yield 'closing';
        }
      }

      @timedMethod({ context: 0, kind: 'async-generator', duration: settings })
      async *updates(_context: Request): AsyncGenerator<string, void, void> {
        try {
          yield 'update';
        } finally {
          yield 'closing';
        }
      }
    }
    const service = new Service();
    const unopened = service.rows({ trace: 'unopened' });
    expect(unopened.return()).toEqual({ done: true, value: undefined });
    const unopenedAsync = service.updates({ trace: 'unopened' });
    await expect(unopenedAsync.return()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(settings).not.toHaveBeenCalled();

    const rows = service.rows({ trace: 'rows' });
    const updates = service.updates({ trace: 'updates' });
    expect(rows.next()).toEqual({ done: false, value: 'row' });
    await expect(updates.next()).resolves.toEqual({
      done: false,
      value: 'update',
    });
    expect(() => rows[Symbol.dispose]()).toThrow(TypeError);
    await expect(updates[Symbol.asyncDispose]()).rejects.toThrow(TypeError);
    expect(rows.next()).toEqual({ done: true, value: undefined });
    await expect(updates.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(settings).toHaveBeenCalledTimes(2);
  });

  test('synchronous body and owned link failures retain both identities', () => {
    const parent = new AbortController();
    const primary = { role: 'body' };
    const cleanup = { role: 'unlink' };
    const remove = vi
      .spyOn(parent.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw cleanup;
      });
    const run = timed(
      (_context: Request): string => {
        throw primary;
      },
      { context: 0, kind: 'sync', duration: 50 },
    );
    let failure: unknown;
    try {
      run({ trace: 'x', signal: parent.signal });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SuppressedError);
    expect((failure as SuppressedError).error).toBe(cleanup);
    expect((failure as SuppressedError).suppressed).toBe(primary);
    remove.mockRestore();
  });

  test('combined local cancellation is directional and waits for body and cleanup', async () => {
    const started = deferred();
    const gate = deferred();
    const cleanup = deferred();
    let child!: AbortSignal;
    async function work(context: Request) {
      child = context.signal!;
      started.resolve();
      try {
        await gate.promise;
        return context.trace;
      } finally {
        await cleanup.promise;
      }
    }
    const run = timedCancellable(work, { context: 0, duration: 5_000 });
    class Service {
      @cancellableMethod({ context: 0, duration: 5_000 })
      async run(context: Request) {
        return work(context);
      }
    }
    const parent = new AbortController();
    const result = run({ trace: 'value', signal: parent.signal });
    expect(result).toBeInstanceOf(PromiseCancellable);
    await started.promise;
    const reason = { stop: true };
    result.cancel(reason);
    expect(child.reason).toBe(reason);
    expect(parent.signal.aborted).toBe(false);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    gate.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    cleanup.resolve();
    await expect(result).resolves.toBe('value');
    await expect(new Service().run({ trace: 'method' })).resolves.toBe(
      'method',
    );
  });

  test('combined cancellation does not cancel an independent body promise', async () => {
    const entered = deferred();
    const gate = deferred<number>();
    const body = PromiseCancellable.from(gate.promise, {
      policy: 'request-only',
    });
    let child!: AbortSignal;
    const run = timedCancellable(
      (context: Request) => {
        child = context.signal!;
        entered.resolve();
        return body;
      },
      { context: 0, duration: 5000 },
    );
    const result = run({ trace: 'value' });
    await entered.promise;
    const reason = { stop: true };
    result.cancel(reason);
    expect(child.reason).toBe(reason);
    expect(body.signal.aborted).toBe(false);
    gate.resolve(42);
    await expect(result).resolves.toBe(42);
  });

  test('combined method preserves a declared cancellable result', async () => {
    const entered = deferred();
    const gate = deferred<number>();
    const body = PromiseCancellable.from(gate.promise, {
      policy: 'request-only',
    });
    let child!: AbortSignal;
    class Service {
      @cancellableMethod({ context: 0, duration: 5000 })
      run(context: Request): PromiseCancellable<number> {
        child = context.signal!;
        entered.resolve();
        return body;
      }
    }
    const result = new Service().run({ trace: 'value' });
    expect(result).toBeInstanceOf(PromiseCancellable);
    await entered.promise;
    const reason = { stop: true };
    result.cancel(reason);
    expect(child.reason).toBe(reason);
    expect(body.signal.aborted).toBe(false);
    gate.resolve(42);
    await expect(result).resolves.toBe(42);
  });

  test('rejects incompatible deadlines and preserves pre-aborted reasons', () => {
    const reason = { stop: true };
    const parent = new AbortController();
    parent.abort(reason);
    const run = timed((context: Request) => context.signal?.reason, {
      context: 0,
      kind: 'sync',
      duration: 10,
    });
    expect(run({ trace: 'x', signal: parent.signal })).toBe(reason);
    expect(() =>
      run({ trace: 'x', deadline: { clock: { now: () => 0 }, at: 10 } }),
    ).toThrow(TypeError);
    expect(timerClock).toBeDefined();
  });
});
