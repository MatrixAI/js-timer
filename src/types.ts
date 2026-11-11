import type {
  ContextCancellation,
  ContextDeadlineClock,
  ContextDeadlineRequirement,
} from '@matrixai/contexts';
import type Timer from './Timer.js';

type TimerContext<T = void> = { readonly timer: Timer<T> };
type TimerScopeOptions<T = void> = {
  readonly delay: number;
  readonly handler?: (signal: AbortSignal) => T | PromiseLike<T>;
};
type DeadlineContext = ContextCancellation & ContextDeadlineRequirement;
type DeadlineInput = Partial<DeadlineContext>;
type TimeoutScopeOptions = {
  readonly duration: number;
  readonly clock?: ContextDeadlineClock;
};

export type {
  TimerContext,
  TimerScopeOptions,
  DeadlineContext,
  DeadlineInput,
  TimeoutScopeOptions,
};
