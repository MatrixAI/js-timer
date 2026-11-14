import type { ContextOperation } from '@matrixai/contexts';
import type { TimerContext } from '#context.js';
import type { PromiseCancellable } from '@matrixai/async-cancellable';
import type { TimingFunctionCheck, TimingKindCheck } from '#functions/types.js';
import { expectTypeOf, test } from 'vitest';
import { timed, timedCancellable } from '#functions/index.js';
import {
  timed as timedMethod,
  timedCancellable as cancellableMethod,
} from '#decorators/index.js';
import {
  createTimeoutScope,
  createTimerScope,
  createTimingFacades,
  Timer,
} from '#index.js';

test('timer and scope expose their result and remaining requirements', () => {
  const timer = new Timer<number>(() => 42);
  expectTypeOf(timer).toExtend<PromiseLike<number>>();
  expectTypeOf(timer.wait()).toEqualTypeOf<Promise<number>>();
  expectTypeOf(timer.signal).toEqualTypeOf<AbortSignal>();

  const operation: ContextOperation<
    TimerContext<number> & { trace: string },
    number
  > = async ({ timer: owned, trace }) => (await owned) + trace.length;
  const scoped = createTimerScope({ delay: 0, handler: () => 42 })(operation);
  expectTypeOf(scoped({ trace: 'typed' })).toEqualTypeOf<Promise<number>>();
  // @ts-expect-error The timer scope does not supply an unrelated trace.
  void scoped({});
});

test('timing facades do not claim refined timer capabilities', () => {
  const scope = createTimerScope({ delay: 0, handler: () => 42 });
  type Input = { trace: string; timer?: Timer<number>; signal?: AbortSignal };
  const facades = createTimingFacades<Input>()(scope);
  const run = facades.function(async (context: Input) => context.trace, {
    context: 0,
  });
  expectTypeOf(run({ trace: 'typed' })).toEqualTypeOf<Promise<string>>();
  type Refined = {
    timer: Timer<number> & { special: true };
    signal?: AbortSignal;
  };
  // @ts-expect-error The scope supplies an ordinary timer, not a refinement.
  createTimingFacades<Refined>()(scope);
  type Union =
    | Input
    | {
        trace: string;
        timer?: Timer<number> & { special: true };
        signal?: AbortSignal;
      };
  // @ts-expect-error Every union alternative must accept the supplied timer.
  createTimingFacades<Union>()(scope);
  type RefinedSignal = {
    signal?: AbortSignal & { special: true };
    deadline?: { clock: { now(): number }; at: number };
  };
  // @ts-expect-error A timeout supplies an ordinary signal, not a refinement.
  createTimingFacades<RefinedSignal>()(createTimeoutScope({ duration: 1 }));
});

test('plain timing rejects return capabilities it cannot preserve', () => {
  type Context = { signal?: AbortSignal };
  const cancellable = (_ctx: Context): PromiseCancellable<number> => {
    throw new Error('type-only');
  };
  const generator = (_ctx: Context): Generator<number> & { special: true } => {
    throw new Error('type-only');
  };
  const asyncGenerator = (
    _ctx: Context,
  ): AsyncGenerator<number> & { special: true } => {
    throw new Error('type-only');
  };

  // @ts-expect-error Plain async timing returns a native promise, not this subtype.
  timed(cancellable, { context: 0, kind: 'async', duration: 5 });
  // @ts-expect-error The generator wrapper does not preserve extra capabilities.
  timed(generator, { context: 0, kind: 'generator', duration: 5 });
  // @ts-expect-error The async generator wrapper does not preserve extra capabilities.
  timed(asyncGenerator, { context: 0, kind: 'async-generator', duration: 5 });
  const combined = timedCancellable(cancellable, { context: 0, duration: 5 });
  expectTypeOf(combined({})).toEqualTypeOf<PromiseCancellable<number>>();

  class Service {
    // @ts-expect-error A standard decorator cannot preserve this promise subtype.
    @timedMethod({ context: 0, kind: 'async', duration: 5 })
    run(_ctx: Context): PromiseCancellable<number> {
      throw new Error('type-only');
    }
    // @ts-expect-error The decorated iterator cannot retain extra capabilities.
    @timedMethod({ context: 0, kind: 'generator', duration: 5 })
    rows(_ctx: Context): Generator<number> & { special: true } {
      throw new Error('type-only');
    }
    // @ts-expect-error The decorated async iterator cannot retain extra capabilities.
    @timedMethod({ context: 0, kind: 'async-generator', duration: 5 })
    updates(_ctx: Context): AsyncGenerator<number> & { special: true } {
      throw new Error('type-only');
    }
    // @ts-expect-error The combined decorator cannot retain extra promise capabilities.
    @cancellableMethod({ context: 0, duration: 5 })
    combined(_ctx: Context): PromiseCancellable<number> & { special: true } {
      throw new Error('type-only');
    }
  }
  void Service;
});

test('named authoring forms preserve protocol and declared method signatures', () => {
  type Context = { trace: string; signal?: AbortSignal };
  const contextCheck: TimingFunctionCheck<[Context], 0> = undefined;
  const generatorCheck: TimingKindCheck<
    Generator<string, number, boolean>,
    'generator'
  > = undefined;
  void contextCheck;
  void generatorCheck;
  const sync = timed((ctx: Context) => ctx.trace, {
    context: 0,
    kind: 'sync',
    duration: 5,
  });
  const asyncRun = timed(async (ctx: Context) => ctx.trace, {
    context: 0,
    kind: 'async',
    duration: 5,
  });
  const combined = timedCancellable(async (ctx: Context) => ctx.trace, {
    context: 0,
    duration: 5,
  });
  function* generatorBody(ctx: Context): Generator<string, number, boolean> {
    yield ctx.trace;
    return 1;
  }
  async function* asyncGeneratorBody(
    ctx: Context,
  ): AsyncGenerator<string, number, boolean> {
    yield ctx.trace;
    return 1;
  }
  const generator = timed(generatorBody, {
    context: 0,
    kind: 'generator',
    duration: 5,
  });
  const asyncGenerator = timed(asyncGeneratorBody, {
    context: 0,
    kind: 'async-generator',
    duration: 5,
  });
  expectTypeOf(sync({ trace: 'x' })).toEqualTypeOf<string>();
  expectTypeOf(asyncRun({ trace: 'x' })).toEqualTypeOf<Promise<string>>();
  expectTypeOf(combined({ trace: 'x' })).toEqualTypeOf<
    PromiseCancellable<string>
  >();
  expectTypeOf(generator({ trace: 'x' })).toEqualTypeOf<
    Generator<string, number, boolean>
  >();
  expectTypeOf(asyncGenerator({ trace: 'x' })).toEqualTypeOf<
    AsyncGenerator<string, number, boolean>
  >();
  function* refinedGenerator(_ctx: {
    signal: AbortSignal & { special: true };
  }): Generator<string> {
    yield 'value';
  }
  // @ts-expect-error The timing owner does not supply a refined signal to a generator.
  timed(refinedGenerator, { context: 0, kind: 'generator', duration: 5 });
  async function* refinedAsyncGenerator(_ctx: {
    deadline: { clock: { now(): number }; at: number; special: true };
  }): AsyncGenerator<string> {
    yield 'value';
  }
  // @ts-expect-error The timing owner does not supply a refined deadline to an async generator.
  timed(refinedAsyncGenerator, {
    context: 0,
    kind: 'async-generator',
    duration: 5,
  });
  type UnionContext =
    Context | { trace: string; signal: AbortSignal & { special: true } };
  function* unionGenerator(_ctx: UnionContext): Generator<string> {
    yield 'value';
  }
  // @ts-expect-error Every union alternative must accept the provided signal.
  timed(unionGenerator, { context: 0, kind: 'generator', duration: 5 });

  class Service {
    @timedMethod({ context: 0, kind: 'sync', duration: 5 })
    sync(ctx: Context) {
      return ctx.trace;
    }
    @timedMethod({ context: 0, kind: 'generator', duration: 5 })
    *generator(ctx: Context): Generator<string, number, boolean> {
      yield ctx.trace;
      return 1;
    }
    @timedMethod({ context: 0, kind: 'async-generator', duration: 5 })
    async *asyncGenerator(
      ctx: Context,
    ): AsyncGenerator<string, number, boolean> {
      yield ctx.trace;
      return 1;
    }
    @cancellableMethod({ context: 0, duration: 5 })
    async combined(ctx: Context) {
      return ctx.trace;
    }
    @cancellableMethod({ context: 0, duration: 5 })
    cancellable(_ctx: Context): PromiseCancellable<number> {
      throw new Error('type-only');
    }
  }
  expectTypeOf(new Service().combined({ trace: 'x' })).toEqualTypeOf<
    Promise<string>
  >();
  expectTypeOf(new Service().cancellable({ trace: 'x' })).toEqualTypeOf<
    PromiseCancellable<number>
  >();
  // @ts-expect-error Promise-returning work does not preserve the synchronous protocol.
  timed(async (ctx: Context) => ctx.trace, {
    context: 0,
    kind: 'sync',
    duration: 5,
  });
  // @ts-expect-error The selected slot is not a context record.
  timed((name: string, ctx: Context) => `${name}${ctx.trace}`, {
    context: 0,
    kind: 'sync',
    duration: 5,
  });
  // @ts-expect-error A plain AbortSignal cannot satisfy a refined capability.
  timed((ctx: { signal: AbortSignal & { special: true } }) => ctx.signal, {
    context: 0,
    kind: 'sync',
    duration: 5,
  });
});
