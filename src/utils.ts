import type {
  ContextDeadlineClock,
  ContextFunction,
  ContextFunctionOptions,
  ContextScope,
  ContextTransform,
} from '@matrixai/contexts';
import { scopeContextFunction, scopeContextMethod } from '@matrixai/contexts';
import { readEpochMilliseconds } from './clock.js';

type Incompatible<Context, Provided> = Context extends unknown
  ? {
      [
        Key in keyof Context & keyof Provided
      ]: Provided[Key] extends Context[Key] ? never : Key;
    }[keyof Context & keyof Provided]
  : never;

type FacadeCompatibility<Context, Needs, Provided> = [Context] extends [Needs]
  ? [Incompatible<Context, Provided>] extends [never]
    ? unknown
    : never
  : never;

/** Normalize numeric delays to the host timeout range, retaining infinity. */
function normalizeDelay(delay: number): number {
  if (Number.isNaN(delay)) return 0;
  return delay === Infinity
    ? Infinity
    : Math.min(Math.max(delay, 0), 2 ** 31 - 1);
}

/** Calculate a nonnegative whole-millisecond remainder from numeric readings. */
function remainingTime(scheduled: number, now: number): number {
  return Math.max(Math.trunc(scheduled - now), 0);
}

/** Preserve a weakly monotonic timestamp after the clock has been read. */
function monotonicTimestamp(previous: number, current: number): number {
  return Math.max(previous, Math.trunc(current));
}

/** Intersect numeric bounds after their clock and finiteness are validated. */
function earlierDeadline(parent: number, next: number): number {
  return Math.min(parent, next);
}

/** Shared portable epoch clock with weakly monotonic module-local state. */
const timestampNow = (() => {
  let lastTimestamp = -Infinity;
  return (): number => {
    const timestamp = readEpochMilliseconds();
    lastTimestamp = monotonicTimestamp(lastTimestamp, timestamp);
    return lastTimestamp;
  };
})();

/** Read and validate an externally supplied clock at the timing boundary. */
function readClock(clock: ContextDeadlineClock): number {
  const now = clock.now();
  if (!Number.isFinite(now)) {
    throw new TypeError('Clock readings must be finite');
  }
  return now;
}

/**
 * Adapt one timing scope to signature-preserving functions and standard methods.
 * The context argument remains part of the public signature; optional provider
 * fields let callers omit capabilities that the scope supplies. Use the scope
 * directly when requirements must be removed from an operation's input type.
 * The supplied scope owns acquisition and release for each invocation.
 */
function createTimingFacades<Context extends object>() {
  return function <Needs extends object, Provided extends object>(
    scope: ContextScope<Needs, Provided> &
      FacadeCompatibility<Context, Needs, Provided>,
  ) {
    // The compatibility check rejects stronger overlapping fields. The scope
    // itself performs record validation, projection, and all resource ownership.
    const transform = scope as unknown as ContextTransform<Context, Context>;
    return {
      function<
        This,
        Args extends unknown[],
        Result,
        const Position extends number | 'last',
      >(
        operation: Parameters<
          typeof scopeContextFunction<Context, This, Args, Result, Position>
        >[0],
        options: ContextFunctionOptions<Position>,
      ): ContextFunction<This, Args, Result> {
        return scopeContextFunction<Context, This, Args, Result, Position>(
          operation,
          transform,
          options,
        );
      },
      method<const Position extends number | 'last'>(
        options: ContextFunctionOptions<Position>,
      ) {
        return scopeContextMethod<Context, Position>(transform, options);
      },
    };
  };
}

export {
  createTimingFacades,
  normalizeDelay,
  remainingTime,
  monotonicTimestamp,
  earlierDeadline,
  timestampNow,
  readClock,
};
