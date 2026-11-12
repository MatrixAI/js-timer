import type {
  ContextBodyExit,
  ContextDeadlineConstraint,
} from '@matrixai/contexts';
import type { DeadlineContext } from '../types.js';
import { bracketResource } from '@matrixai/contexts';
import { CancellationController } from '@matrixai/async-cancellable';
import Timer from '../Timer.js';
import { readClock } from '../utils.js';
import { ErrorTimerDeadlineExceeded } from '../errors.js';

/** Owns one deadline scope invocation's controller, scheduler, monitor and release. */
class DeadlineScopeOwner {
  private readonly cancellation: CancellationController;
  private readonly released = Symbol('deadline scope released');
  private timer?: Timer<void>;
  private closed = false;

  public constructor(
    private readonly deadline: ContextDeadlineConstraint,
    parent?: AbortSignal,
  ) {
    this.cancellation = new CancellationController(parent);
  }

  private readonly stopScheduling = () => {
    this.timer?.cancel(this.released);
  };

  private schedule(remaining: number): Timer<void> {
    // Host timeouts are bounded and can wake before the supplied clock advances.
    return new Timer({ delay: Math.min(remaining, 2 ** 31 - 1) });
  }

  private async monitor(initial: Timer<void>): Promise<void> {
    let current = initial;
    while (true) {
      const exit = await current.completion;
      if (exit.status === 'rejected') {
        if (
          (this.closed || this.cancellation.signal.aborted) &&
          exit.reason === this.released
        ) {
          return;
        }
        throw exit.reason;
      }
      if (this.closed || this.cancellation.signal.aborted) return;
      const remaining = this.deadline.at - readClock(this.deadline.clock);
      if (remaining <= 0) {
        this.cancellation.abort(new ErrorTimerDeadlineExceeded());
        return;
      }
      this.timer = this.schedule(remaining);
      current = this.timer;
    }
  }

  private unlink(): void {
    let removalFailed = false;
    let removalFailure: unknown;
    try {
      this.cancellation.signal.removeEventListener(
        'abort',
        this.stopScheduling,
      );
    } catch (failure) {
      removalFailed = true;
      removalFailure = failure;
    }
    try {
      this.cancellation.close();
    } catch (failure) {
      if (removalFailed) {
        throw new SuppressedError(
          failure,
          removalFailure,
          'Deadline link cleanup failed',
        );
      }
      throw failure;
    }
    if (removalFailed) throw removalFailure;
  }

  public async run<A>(
    body: (context: DeadlineContext) => Promise<A>,
  ): Promise<A> {
    return bracketResource(
      () => {
        try {
          this.cancellation.signal.addEventListener(
            'abort',
            this.stopScheduling,
            { once: true },
          );
          const remaining = this.deadline.at - readClock(this.deadline.clock);
          if (!this.cancellation.signal.aborted && remaining <= 0) {
            this.cancellation.abort(new ErrorTimerDeadlineExceeded());
          }
          if (!this.cancellation.signal.aborted) {
            this.timer = this.schedule(remaining);
          }
          const watching =
            this.timer == null ? Promise.resolve() : this.monitor(this.timer);
          return {
            watching: watching.then<
              ContextBodyExit<void>,
              ContextBodyExit<void>
            >(
              () => Object.freeze({ status: 'fulfilled', value: undefined }),
              (reason: unknown) => {
                this.cancellation.abort(reason);
                return Object.freeze({ status: 'rejected', reason });
              },
            ),
          };
        } catch (error) {
          this.closed = true;
          this.timer?.cancel(this.released);
          try {
            this.unlink();
          } catch (cleanup) {
            throw new SuppressedError(
              cleanup,
              error,
              'Deadline acquisition and cleanup failed',
            );
          }
          throw error;
        }
      },
      () => body({ deadline: this.deadline, signal: this.cancellation.signal }),
      async ({ watching }) => {
        this.closed = true;
        this.timer?.cancel(this.released);
        return bracketResource(
          () => undefined,
          async () => {
            const exit = await watching;
            if (exit.status === 'rejected') throw exit.reason;
          },
          () => this.unlink(),
        );
      },
    );
  }
}

export default DeadlineScopeOwner;
