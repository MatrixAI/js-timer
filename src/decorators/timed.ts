import type {
  TimingFunctionCheck,
  TimingKind,
  TimingKindCheck,
  TimingOptions,
  TimingResult,
} from '../functions/types.js';
import { timed as timedFunction } from '../functions/timed.js';

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

export { timed };
