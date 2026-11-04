import type { ContextScope } from '@matrixai/contexts';
import { bracketResource, createContextScope } from '@matrixai/contexts';
import Timer from './Timer.js';

type TimerContext<T = void> = { readonly timer: Timer<T> };

type TimerScopeOptions<T = void> = {
  readonly delay: number;
  readonly handler?: (signal: AbortSignal) => T | PromiseLike<T>;
};

/**
 * Own a fresh timer per execution, not per scope construction.
 *
 * Cancellation signals a started handler but
 * does not replace its completion. Scope release cancels pending scheduling,
 * waits for started work, and reports an otherwise unobserved timer failure.
 * This supplies a timer, not a fixed deadline or parent cancellation policy.
 */
function createTimerScope<T = void>(
  { delay, handler }: TimerScopeOptions<T>,
): ContextScope<object, TimerContext<T>> {
  return createContextScope<object, TimerContext<T>>(async (_outer, body) => {
    const released = Symbol('timer scope released');
    return bracketResource(
      () => {
        const timer = new Timer<T>({ delay, handler });
        // Retain actual execution, never an abandonable caller wait.
        const completion = timer.completion;
        return { timer, completion };
      },
      ({ timer }) => body({ timer }),
      async ({ timer, completion }, exit) => {
        timer.cancel(released);
        const outcome = await completion;
        if (
          outcome.status === 'rejected' &&
          outcome.reason !== released &&
          !(exit.status === 'rejected' && Object.is(exit.reason, outcome.reason))
        ) {
          throw outcome.reason;
        }
      },
    );
  });
}

export { createTimerScope };
export type { TimerContext, TimerScopeOptions };
