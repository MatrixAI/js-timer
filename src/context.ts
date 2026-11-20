import type { ContextCancellation, ContextScope } from '@matrixai/contexts';
import type { TimerContext, TimerScopeOptions } from './types.js';
import { bracketResource, createContextScope } from '@matrixai/contexts';
import Timer from './Timer.js';

/**
 * Own a fresh timer per execution, not per scope construction.
 *
 * Cancellation signals a started handler but
 * does not replace its completion. Scope release cancels pending scheduling,
 * waits for started work, and reports an otherwise unobserved timer failure.
 * An outer signal is borrowed directionally for this invocation. This supplies
 * a timer, not a fixed deadline or authority over the outer controller.
 */
function createTimerScope<T = void>({
  delay,
  handler,
}: TimerScopeOptions<T>): ContextScope<
  Partial<ContextCancellation>,
  TimerContext<T>
> {
  return createContextScope<Partial<ContextCancellation>, TimerContext<T>>(
    async (outer, body) => {
      const released = Symbol('timer scope released');
      return bracketResource(
        () => {
          const timer = new Timer<T>({ delay, handler, signal: outer.signal });
          // Retain actual execution, never an abandonable caller wait.
          const completion = timer.completion;
          return { timer, completion };
        },
        ({ timer }) => body({ timer }),
        async ({ timer, completion }) => {
          const pending = timer.status === null;
          timer.cancel(released);
          const outcome = await completion;
          if (
            outcome.status === 'rejected' &&
            !(pending && outcome.reason === released)
          ) {
            throw outcome.reason;
          }
        },
      );
    },
  );
}

export { createTimerScope };
export type { TimerContext, TimerScopeOptions };
