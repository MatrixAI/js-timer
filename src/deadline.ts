import type {
  ContextCancellation,
  ContextDeadlineClock,
  ContextDeadlineConstraint,
  ContextDeadlineRequirement,
  ContextScope,
  ContextScopeExit,
} from '@matrixai/contexts';
import { bracketResource, createContextScope } from '@matrixai/contexts';
import { createCancellation } from '@matrixai/async-cancellable';
import Timer from './Timer.js';
import { timestampNow } from './clock.js';
import { ErrorTimerDeadlineExceeded } from './errors.js';

type DeadlineContext = ContextCancellation & ContextDeadlineRequirement;
type DeadlineInput = Partial<DeadlineContext>;
type TimeoutScopeOptions = {
  readonly duration: number;
  readonly clock?: ContextDeadlineClock;
};

/** Stable identity for this module instance's portable epoch-millisecond clock. */
const timerClock: ContextDeadlineClock = Object.freeze({ now: timestampNow });

/** Pure constraint intersection. No scheduling or cancellation is performed. */
function constrainDeadline(
  next: ContextDeadlineConstraint,
  parent?: ContextDeadlineConstraint,
): ContextDeadlineConstraint {
  if (!Number.isFinite(next.at) || (parent != null && !Number.isFinite(parent.at))) {
    throw new TypeError('Absolute deadlines must have finite timestamps');
  }
  if (typeof next.clock?.now !== 'function') {
    throw new TypeError('A deadline requires a clock');
  }
  if (parent != null && parent.clock !== next.clock) {
    throw new TypeError('Cannot compare deadlines from different clocks');
  }
  return Object.freeze({
    clock: next.clock,
    at: parent == null ? next.at : Math.min(parent.at, next.at),
  });
}

function createDeadlineConstraintScope(
  constraint: ContextDeadlineConstraint,
): ContextScope<Partial<ContextDeadlineRequirement>, ContextDeadlineRequirement> {
  const captured = constrainDeadline(constraint);
  return createContextScope<Partial<ContextDeadlineRequirement>, ContextDeadlineRequirement>(async (outer, body) => body({
    deadline: constrainDeadline(captured, outer.deadline),
  }));
}

/** Enforce a captured fixed deadline without widening an inherited constraint. */
function createDeadlineScope(
  constraint: ContextDeadlineConstraint,
): ContextScope<DeadlineInput, DeadlineContext> {
  const captured = constrainDeadline(constraint);
  return createContextScope<DeadlineInput, DeadlineContext>(async (outer, body) => {
    const deadline = constrainDeadline(captured, outer.deadline);
    return enterDeadline(deadline, outer.signal, body);
  });
}

/** A fresh relative budget per invocation, still bounded by any parent deadline. */
function createTimeoutScope(
  { duration, clock = timerClock }: TimeoutScopeOptions,
): ContextScope<DeadlineInput, DeadlineContext> {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('A timeout duration must be finite and nonnegative');
  }
  return createContextScope<DeadlineInput, DeadlineContext>(async (outer, body) => {
    const deadline = constrainDeadline({ clock, at: readClock(clock) + duration }, outer.deadline);
    return enterDeadline(deadline, outer.signal, body);
  });
}

function readClock(clock: ContextDeadlineClock): number {
  const now = clock.now();
  if (!Number.isFinite(now)) throw new TypeError('Clock readings must be finite');
  return now;
}

/** Provider-owned enforcement; the body is always given the effective state. */
async function enterDeadline<A>(
  deadline: ContextDeadlineConstraint,
  parent: AbortSignal | undefined,
  body: (context: DeadlineContext) => Promise<A>,
): Promise<A> {
  const cancellation = createCancellation(parent);
  const released = Symbol('deadline scope released');
  let timer: Timer<void> | undefined;
  let closed = false;
  const stopScheduling = () => { timer?.cancel(released); };

  function schedule(remaining: number): Timer<void> {
    // Recheck on wakeup: native timers have a bounded range, may fire early,
    // and a caller-provided clock need not advance with the host scheduler.
    return new Timer({ delay: Math.min(remaining, 2 ** 31 - 1) });
  }

  async function monitor(initial: Timer<void>): Promise<void> {
    let current = initial;
    while (!closed && !cancellation.signal.aborted) {
      const exit = await current.completion;
      if (closed || cancellation.signal.aborted) return;
      if (exit.status === 'rejected') throw exit.reason;
      const remaining = deadline.at - readClock(deadline.clock);
      if (remaining <= 0) {
        cancellation.cancel(new ErrorTimerDeadlineExceeded());
        return;
      }
      timer = schedule(remaining);
      current = timer;
    }
  }

  function unlink(): void {
    try {
      cancellation.signal.removeEventListener('abort', stopScheduling);
    } finally {
      cancellation.close();
    }
  }

  return bracketResource(
    () => {
      try {
        cancellation.signal.addEventListener('abort', stopScheduling, { once: true });
        const remaining = deadline.at - readClock(deadline.clock);
        if (!cancellation.signal.aborted && remaining <= 0) {
          cancellation.cancel(new ErrorTimerDeadlineExceeded());
        }
        if (!cancellation.signal.aborted) timer = schedule(remaining);
        const watching = timer == null ? Promise.resolve() : monitor(timer);
        return {
          watching: watching.then<ContextScopeExit<void>, ContextScopeExit<void>>(
            () => Object.freeze({ status: 'fulfilled', value: undefined }),
            (reason: unknown) => {
              cancellation.cancel(reason);
              return Object.freeze({ status: 'rejected', reason });
            },
          ),
        };
      } catch (error) {
        closed = true;
        timer?.cancel(released);
        try {
          unlink();
        } catch (cleanup) {
          throw new SuppressedError(cleanup, error, 'Deadline acquisition and cleanup failed');
        }
        throw error;
      }
    },
    () => body({ deadline, signal: cancellation.signal }),
    async ({ watching }, bodyExit) => {
      closed = true;
      timer?.cancel(released);
      return bracketResource(
        () => undefined,
        async () => {
        const monitorExit = await watching;
        if (
          monitorExit.status === 'rejected' &&
          !(bodyExit.status === 'rejected' && Object.is(bodyExit.reason, monitorExit.reason))
        ) throw monitorExit.reason;
        },
        () => unlink(),
      );
    },
  );
}

export {
  timerClock,
  constrainDeadline,
  createDeadlineConstraintScope,
  createDeadlineScope,
  createTimeoutScope,
};
export type { DeadlineContext, DeadlineInput, TimeoutScopeOptions };
