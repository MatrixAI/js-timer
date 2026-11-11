import type { ContextFunction } from '@matrixai/contexts';
import type { TimingFunctionCheck, TimingOptions } from '../functions/types.js';
import { timedCancellable as timedCancellableFunction } from '../functions/timedCancellable.js';

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

export { timedCancellable };
