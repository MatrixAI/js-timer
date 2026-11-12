import type {
  ContextBodyExit,
  ContextDeadlineConstraint,
} from '@matrixai/contexts';
import type {
  DeadlineControllerOptions,
  DeadlineMonitoringState,
} from './types.js';
import { CancellationController } from '@matrixai/async-cancellable';
import { constrainDeadline, timerClock } from './utils.js';
import { ErrorTimerDeadlineExceeded } from '../errors.js';
import { readClock } from '../utils.js';

/**
 * Owns a fixed deadline's scheduler and directional cancellation links.
 * Consumers borrow the deadline and signal; they are not joined by this owner.
 * Closing releases resources without aborting or waiting for consumer work.
 */
class DeadlineController extends CancellationController {
  public readonly deadline: ContextDeadlineConstraint;
  public readonly monitoring: Promise<ContextBodyExit<void>>;
  private resolveMonitoring!: (outcome: ContextBodyExit<void>) => void;
  private state: DeadlineMonitoringState = Object.freeze({ status: 'pending' });
  private handle?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private callbacks = 0;
  private released = false;
  private stopped = false;
  private listenerInstalled = false;
  private monitorFailed = false;
  private monitorFailure: unknown;

  public constructor(options: DeadlineControllerOptions) {
    super();
    if (options == null || typeof options !== 'object') {
      throw new TypeError('Deadline options are required');
    }
    const hasDeadline = options.deadline !== undefined;
    const hasDuration = options.duration !== undefined;
    if (
      hasDeadline === hasDuration ||
      (hasDeadline && options.clock !== undefined)
    ) {
      throw new TypeError('Select exactly one deadline or duration');
    }
    let now: number;
    let deadline: ContextDeadlineConstraint;
    if (hasDeadline) {
      deadline = constrainDeadline(options.deadline!, options.parentDeadline);
      now = readClock(deadline.clock);
    } else {
      const duration = options.duration!;
      if (!Number.isFinite(duration) || duration < 0) {
        throw new RangeError(
          'A deadline duration must be finite and nonnegative',
        );
      }
      const clock = options.clock ?? timerClock;
      now = readClock(clock);
      deadline = constrainDeadline(
        { clock, at: now + duration },
        options.parentDeadline,
      );
    }
    this.deadline = deadline;
    this.monitoring = new Promise((resolve) => {
      this.resolveMonitoring = resolve;
    });
    try {
      // A patched host may install the listener before reporting failure.
      this.listenerInstalled = true;
      this.signal.addEventListener('abort', this.onAbort);
      if (options.signal != null) this.link(options.signal);
      if (!this.signal.aborted) {
        if (deadline.at <= now) {
          this.abort(new ErrorTimerDeadlineExceeded());
        } else {
          this.schedule(deadline.at - now);
        }
      }
    } catch (primary) {
      try {
        this.close();
      } catch (cleanup) {
        throw new SuppressedError(
          cleanup,
          primary,
          'Deadline acquisition and cleanup failed',
        );
      }
      throw primary;
    }
  }

  public get monitoringState(): DeadlineMonitoringState {
    return this.state;
  }

  /** Disable forwarding and scheduling before attempting retryable cleanup. */
  public override close(): void {
    this.released = true;
    this.stopped = true;
    this.generation += 1;
    const failures: unknown[] = [];
    try {
      super.close();
    } catch (failure) {
      failures.push(failure);
    }
    try {
      this.clearSchedule();
    } catch (failure) {
      failures.push(failure);
    }
    if (this.listenerInstalled) {
      try {
        this.signal.removeEventListener('abort', this.onAbort);
        this.listenerInstalled = false;
      } catch (failure) {
        failures.push(failure);
      }
    }
    this.settleMonitoring();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Deadline cleanup failed');
    }
  }

  private readonly onAbort = (): void => {
    // Dispatching an event manually does not constitute an abort request.
    if (this.released || !this.signal.aborted) return;
    this.stopped = true;
    this.generation += 1;
    try {
      this.clearSchedule();
    } catch (failure) {
      this.recordMonitorFailure(failure);
    }
    this.settleMonitoring();
  };

  private clearSchedule(): void {
    if (this.handle !== undefined) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
  }

  private schedule(remaining: number): void {
    const token = ++this.generation;
    const handle = setTimeout(
      () => this.wakeup(token),
      Math.min(remaining, 2 ** 31 - 1),
    );
    this.handle = handle;
    if (this.stopped || this.released || token !== this.generation) {
      this.clearSchedule();
    }
  }

  private wakeup(token: number): void {
    if (token !== this.generation || this.released || this.stopped) return;
    this.handle = undefined;
    this.callbacks += 1;
    try {
      const remaining = this.deadline.at - readClock(this.deadline.clock);
      if (this.released || this.stopped) return;
      if (remaining <= 0) {
        this.abort(new ErrorTimerDeadlineExceeded());
      } else {
        this.schedule(remaining);
      }
    } catch (failure) {
      this.recordMonitorFailure(failure);
      if (!this.released && !this.signal.aborted) this.abort(failure);
      this.stopped = true;
      this.generation += 1;
    } finally {
      this.callbacks -= 1;
      this.settleMonitoring();
    }
  }

  private recordMonitorFailure(failure: unknown): void {
    this.monitorFailure = this.monitorFailed
      ? new SuppressedError(
          failure,
          this.monitorFailure,
          'Deadline monitoring failed',
        )
      : failure;
    this.monitorFailed = true;
  }

  private settleMonitoring(): void {
    if (
      !this.stopped ||
      this.callbacks !== 0 ||
      this.state.status !== 'pending'
    ) {
      return;
    }
    const outcome: ContextBodyExit<void> = this.monitorFailed
      ? Object.freeze({ status: 'rejected', reason: this.monitorFailure })
      : Object.freeze({ status: 'fulfilled', value: undefined });
    this.state = outcome;
    this.resolveMonitoring(outcome);
  }
}

export default DeadlineController;
