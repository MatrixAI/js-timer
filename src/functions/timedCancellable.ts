import type { ContextFunction } from '@matrixai/contexts';
import type { TimingFunctionCheck, TimingOptions } from './types.js';
import { bracketResource } from '@matrixai/contexts';
import {
  CancellationController,
  PromiseCancellable,
} from '@matrixai/async-cancellable';
import { snapshotContext } from './invocation.js';
import { timedAsync } from './timed.js';

/** Local cancellation requests retain the timed body's actual completion. */
function timedCancellable<
  This,
  Args extends unknown[],
  Result,
  const Position extends number | 'last',
>(
  operation: ContextFunction<This, Args, Result> &
    TimingFunctionCheck<Args, Position>,
  options: Omit<TimingOptions<Position, This, Args>, 'kind'>,
): (this: This, ...args: Args) => PromiseCancellable<Result> {
  const timedOperation = timedAsync(operation, { ...options, kind: 'async' });
  function wrapped(this: This, ...args: Args): PromiseCancellable<Result> {
    const index =
      typeof options.context === 'number' ? options.context : args.length - 1;
    if (index < 0 || index >= args.length) {
      throw new RangeError('The selected context argument is missing');
    }
    const snapshot = snapshotContext(args[index]);
    const controller = new CancellationController(snapshot.signal);
    const forwarded: unknown[] = [...args];
    forwarded[index] = { ...snapshot, signal: controller.signal };
    const completion = bracketResource(
      () => controller,
      () => timedOperation.apply(this, forwarded as Args),
      (owned) => owned.close(),
    );
    return PromiseCancellable.from(completion, {
      policy: 'request-only',
      controller,
    }) as PromiseCancellable<Result>;
  }
  Object.defineProperty(wrapped, 'name', {
    value: operation.name,
    configurable: true,
  });
  return wrapped;
}

export { timedCancellable };
