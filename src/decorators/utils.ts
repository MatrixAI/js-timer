import type { ContextFunction } from '@matrixai/contexts';
import type {
  TimingFunctionCheck,
  TimingKind,
  TimingKindCheck,
  TimingOptions,
  TimingResult,
} from '../functions/types.js';
import {
  timed as timedFunction,
  timedCancellable as timedCancellableFunction,
} from '../functions/index.js';

/** Standard method form of the selected protocol-specific timing policy. */
function timed<
  const Position extends number | 'last',
  const Kind extends TimingKind,
  This = unknown,
  Args extends unknown[] = unknown[],
>(options: TimingOptions<Position, This, Args, Kind>) {
  return function decorate<MethodThis, MethodArgs extends unknown[], Result>(
    method: ((this: MethodThis, ...args: MethodArgs) => Result) &
      TimingFunctionCheck<MethodArgs, Position> &
      TimingKindCheck<Result, Kind> &
      ([TimingResult<Result, Kind>] extends [Result] ? unknown : never),
    metadata: ClassMethodDecoratorContext<
      MethodThis,
      (this: MethodThis, ...args: MethodArgs) => Result
    >,
  ): (this: MethodThis, ...args: MethodArgs) => Result {
    if (metadata.kind !== 'method') {
      throw new TypeError('timed supports standard method decorators only');
    }
    return timedFunction(
      method,
      options as unknown as TimingOptions<
        Position,
        MethodThis,
        MethodArgs,
        Kind
      >,
    ) as (this: MethodThis, ...args: MethodArgs) => Result;
  };
}

/** Standard method form; decoration does not change the static return signature. */
function timedCancellable<
  const Position extends number | 'last',
  This = unknown,
  Args extends unknown[] = unknown[],
>(options: Omit<TimingOptions<Position, This, Args>, 'kind'>) {
  return function decorate<MethodThis, MethodArgs extends unknown[], Result>(
    method: ContextFunction<MethodThis, MethodArgs, Result> &
      TimingFunctionCheck<MethodArgs, Position>,
    metadata: ClassMethodDecoratorContext<
      MethodThis,
      ContextFunction<MethodThis, MethodArgs, Result>
    >,
  ): ContextFunction<MethodThis, MethodArgs, Result> {
    if (metadata.kind !== 'method') {
      throw new TypeError(
        'timedCancellable supports standard method decorators only',
      );
    }
    return timedCancellableFunction(
      method,
      options as unknown as Omit<
        TimingOptions<Position, MethodThis, MethodArgs>,
        'kind'
      >,
    );
  };
}

export { timed, timedCancellable };
