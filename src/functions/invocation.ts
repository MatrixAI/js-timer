import type { TimingKind, TimingOptions } from './types.js';
import type { DeadlineInput } from '../types.js';
import SynchronousDeadlineOwner from '../SynchronousDeadlineOwner.js';
import { readClock } from '../clock.js';
import { constrainDeadline, timerClock } from '../deadline.js';

/** Snapshot supported context data before acquiring any parent link. */
function snapshotContext(
  value: unknown,
): DeadlineInput & Record<PropertyKey, unknown> {
  if (
    value == null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(
      'ContextScope projection requires an ordinary data record',
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(
        'ContextScope projection requires enumerable own data fields',
      );
    }
  }
  return { ...value };
}

function acquireTiming<
  This,
  Args extends unknown[],
  Position extends number | 'last',
  Kind extends TimingKind,
>(
  receiver: This,
  args: Args,
  index: number,
  options: TimingOptions<Position, This, Args, Kind>,
): { owner: SynchronousDeadlineOwner; args: Args } {
  const outer = snapshotContext(args[index]);
  const duration =
    typeof options.duration === 'function'
      ? options.duration.apply(receiver, args)
      : options.duration;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('A timeout duration must be finite and nonnegative');
  }
  const clock = options.clock ?? timerClock;
  const deadline = constrainDeadline(
    { clock, at: readClock(clock) + duration },
    outer.deadline,
  );
  const owner = new SynchronousDeadlineOwner(deadline, outer.signal);
  const forwarded: unknown[] = [...args];
  forwarded[index] = { ...outer, deadline, signal: owner.signal };
  return { owner, args: forwarded as Args };
}

export { snapshotContext, acquireTiming };
