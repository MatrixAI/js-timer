import type { ContextDeadlineClock } from '@matrixai/contexts';
import type { ContextFunctionCheck } from '@matrixai/contexts/functions/index.js';
import type { DeadlineContext } from '../types.js';

type ContextAt<
  Args extends unknown[],
  Position extends number | 'last',
> = Position extends 'last'
  ? Args extends [...unknown[], infer Last]
    ? Last
    : never
  : Position extends number
    ? Args[Position]
    : never;

type Incompatible<Context> = Context extends unknown
  ? Context extends { signal?: infer Signal }
    ? AbortSignal extends NonNullable<Signal>
      ? IncompatibleDeadline<Context>
      : Context
    : IncompatibleDeadline<Context>
  : never;

type IncompatibleDeadline<Context> = Context extends {
  deadline?: infer Deadline;
}
  ? DeadlineContext['deadline'] extends NonNullable<Deadline>
    ? never
    : Context
  : never;

type TimingFunctionCheck<
  Args extends unknown[],
  Position extends number | 'last',
> = ContextFunctionCheck<Args, Position, ContextAt<Args, Position>> &
  ([ContextAt<Args, Position>] extends [object]
    ? [Incompatible<ContextAt<Args, Position>>] extends [never]
      ? unknown
      : never
    : never);

type TimingKind = 'async' | 'sync' | 'generator' | 'async-generator';

type TimingOptions<
  Position extends number | 'last',
  This,
  Args extends unknown[],
  Kind extends TimingKind = 'async',
> = {
  readonly context: Position;
  readonly kind: Kind;
  readonly duration: number | ((this: This, ...args: Args) => number);
  readonly clock?: ContextDeadlineClock;
};

type TimingKindCheck<Result, Kind extends TimingKind> = [Result] extends [never]
  ? unknown
  : Kind extends 'async'
    ? Result extends Promise<unknown>
      ? unknown
      : never
    : Kind extends 'generator'
      ? Result extends Generator<infer _Y, infer _R, infer _N>
        ? unknown
        : never
      : Kind extends 'async-generator'
        ? Result extends AsyncGenerator<infer _Y, infer _R, infer _N>
          ? unknown
          : never
        : Result extends
              PromiseLike<unknown> | Iterator<unknown> | AsyncIterator<unknown>
          ? never
          : unknown;

type TimingResult<Result, Kind extends TimingKind> = Kind extends 'generator'
  ? Result extends Generator<infer Y, infer R, infer N>
    ? Generator<Y, R, N>
    : never
  : Kind extends 'async-generator'
    ? Result extends AsyncGenerator<infer Y, infer R, infer N>
      ? AsyncGenerator<Y, R, N>
      : never
    : Result;

export type {
  TimingFunctionCheck,
  TimingKind,
  TimingKindCheck,
  TimingOptions,
  TimingResult,
};
