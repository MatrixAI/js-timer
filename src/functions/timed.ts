import type { ContextFunction, ContextTransform } from '@matrixai/contexts';
import type { ContextFunctionCheck } from '@matrixai/contexts/functions/index.js';
import type {
  TimingFunctionCheck,
  TimingKind,
  TimingKindCheck,
  TimingOptions,
  TimingResult,
} from './types.js';
import type SynchronousDeadlineOwner from '../SynchronousDeadlineOwner.js';
import {
  ResourceOwningAsyncGenerator,
  scopeContextFunction,
} from '@matrixai/contexts';
import { acquireTiming } from './invocation.js';
import { createTimeoutScope } from '../deadline.js';

/** An invocation-local finite time budget around represented async completion. */
function timedAsync<
  This,
  Args extends unknown[],
  Result,
  const Position extends number | 'last',
>(
  operation: ContextFunction<This, Args, Result> &
    TimingFunctionCheck<Args, Position>,
  options: TimingOptions<Position, This, Args>,
): ContextFunction<This, Args, Result> {
  const { context, kind, clock } = options;
  if (kind !== 'async') throw new TypeError('Expected async timing kind');
  if (
    context !== 'last' &&
    (typeof context !== 'number' ||
      !Number.isSafeInteger(context) ||
      context < 0)
  ) {
    throw new TypeError(
      'Context position must be last or a nonnegative integer',
    );
  }
  function wrapped(this: This, ...args: Args): Promise<Result> {
    const index = typeof context === 'number' ? context : args.length - 1;
    if (index < 0 || index >= args.length) {
      throw new RangeError('The selected context argument is missing');
    }
    const duration =
      typeof options.duration === 'function'
        ? options.duration.apply(this, args)
        : options.duration;
    const transform = createTimeoutScope({
      duration,
      clock,
    }) as unknown as ContextTransform<object, object>;
    return scopeContextFunction<object, This, Args, Result, Position>(
      operation as ContextFunction<This, Args, Result> &
        ContextFunctionCheck<Args, Position, object>,
      transform,
      { context },
    ).apply(this, args);
  }
  Object.defineProperty(wrapped, 'name', {
    value: operation.name,
    configurable: true,
  });
  return wrapped;
}

/** Select the return protocol explicitly; iterator ownership begins at first next. */
function timed<
  F extends (...args: never[]) => unknown,
  const Position extends number | 'last',
>(
  operation: F,
  options: TimingOptions<
    Position,
    ThisParameterType<NoInfer<F>>,
    Parameters<NoInfer<F>>,
    'generator'
  >,
  ...check: [
    TimingFunctionCheck<Parameters<NoInfer<F>>, Position> &
      TimingKindCheck<ReturnType<NoInfer<F>>, 'generator'>,
  ] extends [never]
    ? [invalid: never]
    : []
): (
  this: ThisParameterType<F>,
  ...args: Parameters<F>
) => TimingResult<ReturnType<F>, 'generator'>;
function timed<
  F extends (...args: never[]) => unknown,
  const Position extends number | 'last',
>(
  operation: F,
  options: TimingOptions<
    Position,
    ThisParameterType<NoInfer<F>>,
    Parameters<NoInfer<F>>,
    'async-generator'
  >,
  ...check: [
    TimingFunctionCheck<Parameters<NoInfer<F>>, Position> &
      TimingKindCheck<ReturnType<NoInfer<F>>, 'async-generator'>,
  ] extends [never]
    ? [invalid: never]
    : []
): (
  this: ThisParameterType<F>,
  ...args: Parameters<F>
) => TimingResult<ReturnType<F>, 'async-generator'>;
function timed<
  This,
  Args extends unknown[],
  Result,
  const Position extends number | 'last',
  const Kind extends TimingKind,
>(
  operation: ((this: This, ...args: Args) => Result) &
    TimingFunctionCheck<NoInfer<Args>, NoInfer<Position>> &
    TimingKindCheck<NoInfer<Result>, NoInfer<Kind>>,
  options: TimingOptions<Position, This, Args, Kind>,
): (this: This, ...args: Args) => TimingResult<Result, Kind>;
function timed<
  This,
  Args extends unknown[],
  Result,
  const Position extends number | 'last',
  const Kind extends TimingKind,
>(
  operation: ((this: This, ...args: Args) => Result) &
    TimingFunctionCheck<NoInfer<Args>, NoInfer<Position>> &
    TimingKindCheck<NoInfer<Result>, NoInfer<Kind>>,
  options: TimingOptions<Position, This, Args, Kind>,
  ..._check: unknown[]
): (this: This, ...args: Args) => TimingResult<Result, Kind> {
  const { context, kind } = options;
  if (
    context !== 'last' &&
    (typeof context !== 'number' ||
      !Number.isSafeInteger(context) ||
      context < 0)
  ) {
    throw new TypeError(
      'Context position must be last or a nonnegative integer',
    );
  }
  if (!['async', 'sync', 'generator', 'async-generator'].includes(kind)) {
    throw new TypeError('Unsupported timing kind');
  }
  if (kind === 'async') {
    return timedAsync(
      operation as unknown as ContextFunction<This, Args, unknown> &
        TimingFunctionCheck<Args, Position>,
      options as TimingOptions<Position, This, Args>,
    ) as unknown as (this: This, ...args: Args) => TimingResult<Result, Kind>;
  }
  function wrapped(this: This, ...args: Args): TimingResult<Result, Kind> {
    const receiver = this;
    const index = typeof context === 'number' ? context : args.length - 1;
    if (index < 0 || index >= args.length) {
      throw new RangeError('The selected context argument is missing');
    }
    const acquire = () => acquireTiming(receiver, args, index, options);
    if (kind === 'generator') {
      function* drive(): Generator<unknown, unknown, unknown> {
        const { owner, args: forwarded } = acquire();
        let failed = false;
        let primary: unknown;
        try {
          return yield* operation.apply(receiver, forwarded) as Generator<
            unknown,
            unknown,
            unknown
          >;
        } catch (error) {
          failed = true;
          primary = error;
          throw error;
        } finally {
          releaseGeneratorTiming(owner, failed, primary);
        }
      }
      const iterator = drive();
      Object.defineProperty(iterator, Symbol.dispose, {
        configurable: true,
        value: () => {
          if (!iterator.return(undefined).done) {
            throw new TypeError(
              'Generator cleanup yielded; explicit advancement is required',
            );
          }
        },
      });
      return iterator as TimingResult<Result, Kind>;
    }
    if (kind === 'async-generator') {
      return new ResourceOwningAsyncGenerator(
        acquire,
        ({ args: forwarded }) =>
          operation.apply(receiver, forwarded) as AsyncGenerator<
            unknown,
            unknown,
            unknown
          >,
        ({ owner }) => owner.close(),
      ) as TimingResult<Result, Kind>;
    }
    const { owner, args: forwarded } = acquire();
    let result: Result;
    try {
      result = operation.apply(receiver, forwarded);
    } catch (failure) {
      try {
        owner.close();
      } catch (cleanup) {
        throw new SuppressedError(
          cleanup,
          failure,
          'Timed body and cleanup failed',
        );
      }
      throw failure;
    }
    owner.close();
    return result as TimingResult<Result, Kind>;
  }
  Object.defineProperty(wrapped, 'name', {
    value: operation.name,
    configurable: true,
  });
  return wrapped;
}

/** Preserve source and cleanup failures when a generator terminates. */
function releaseGeneratorTiming(
  owner: SynchronousDeadlineOwner,
  failed: boolean,
  primary: unknown,
): void {
  try {
    owner.close();
  } catch (cleanup) {
    if (failed) {
      throw new SuppressedError(
        cleanup,
        primary,
        'Generator and deadline cleanup failed',
      );
    }
    throw cleanup;
  }
}

export { timed, timedAsync };
