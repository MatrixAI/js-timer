import type {
  ContextDeadlineClock,
  ContextDeadlineConstraint,
  ContextDeadlineRequirement,
  ContextScope,
} from '@matrixai/contexts';
import type {
  DeadlineContext,
  DeadlineInput,
  TimeoutScopeOptions,
} from './types.js';
import { createContextScope } from '@matrixai/contexts';
import DeadlineScopeOwner from './DeadlineScopeOwner.js';
import { readClock, timestampNow } from './clock.js';
import { earlierDeadline } from './utils.js';

/** Stable identity for this module instance's portable epoch-millisecond clock. */
const timerClock: ContextDeadlineClock = Object.freeze({ now: timestampNow });

/** Validate and intersect constraints without scheduling or cancellation. */
function constrainDeadline(
  next: ContextDeadlineConstraint,
  parent?: ContextDeadlineConstraint,
): ContextDeadlineConstraint {
  if (
    !Number.isFinite(next.at) ||
    (parent != null && !Number.isFinite(parent.at))
  ) {
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
    at: parent == null ? next.at : earlierDeadline(parent.at, next.at),
  });
}

function createDeadlineConstraintScope(
  constraint: ContextDeadlineConstraint,
): ContextScope<
  Partial<ContextDeadlineRequirement>,
  ContextDeadlineRequirement
> {
  const captured = constrainDeadline(constraint);
  return createContextScope<
    Partial<ContextDeadlineRequirement>,
    ContextDeadlineRequirement
  >(async (outer, body) =>
    body({
      deadline: constrainDeadline(captured, outer.deadline),
    }),
  );
}

/** Enforce a captured fixed deadline without widening an inherited constraint. */
function createDeadlineScope(
  constraint: ContextDeadlineConstraint,
): ContextScope<DeadlineInput, DeadlineContext> {
  const captured = constrainDeadline(constraint);
  return createContextScope<DeadlineInput, DeadlineContext>(
    async (outer, body) => {
      const deadline = constrainDeadline(captured, outer.deadline);
      return new DeadlineScopeOwner(deadline, outer.signal).run(body);
    },
  );
}

/** A fresh relative budget per invocation, still bounded by any parent deadline. */
function createTimeoutScope({
  duration,
  clock = timerClock,
}: TimeoutScopeOptions): ContextScope<DeadlineInput, DeadlineContext> {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('A timeout duration must be finite and nonnegative');
  }
  return createContextScope<DeadlineInput, DeadlineContext>(
    async (outer, body) => {
      const deadline = constrainDeadline(
        { clock, at: readClock(clock) + duration },
        outer.deadline,
      );
      return new DeadlineScopeOwner(deadline, outer.signal).run(body);
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
