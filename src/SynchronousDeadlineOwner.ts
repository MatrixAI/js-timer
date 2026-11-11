import type { ContextDeadlineConstraint } from '@matrixai/contexts';
import { CancellationController } from '@matrixai/async-cancellable';
import { readClock } from './clock.js';
import { ErrorTimerDeadlineExceeded } from './errors.js';

/** Synchronously releasable scheduler and link for caller-driven work. */
class SynchronousDeadlineOwner {
  public readonly signal: AbortSignal;
  private readonly controller: CancellationController;
  private handle?: ReturnType<typeof setTimeout>;
  private closed = false;
  private monitorFailed = false;
  private monitorFailure: unknown;

  public constructor(
    public readonly deadline: ContextDeadlineConstraint,
    parent?: AbortSignal,
  ) {
    this.controller = new CancellationController(parent);
    this.signal = this.controller.signal;
    try {
      this.signal.addEventListener('abort', this.onAbort, { once: true });
      if (!this.signal.aborted) this.schedule();
    } catch (failure) {
      try {
        this.close();
      } catch (cleanup) {
        throw new SuppressedError(
          cleanup,
          failure,
          'Deadline acquisition and cleanup failed',
        );
      }
      throw failure;
    }
  }

  private readonly stop = () => {
    if (this.handle != null) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
  };

  private readonly onAbort = () => {
    try {
      this.stop();
    } catch (failure) {
      this.monitorFailure = this.monitorFailed
        ? new SuppressedError(
            failure,
            this.monitorFailure,
            'Deadline monitor cleanup failed',
          )
        : failure;
      this.monitorFailed = true;
    }
  };

  private schedule(): void {
    const remaining = this.deadline.at - readClock(this.deadline.clock);
    if (remaining <= 0) {
      this.controller.abort(new ErrorTimerDeadlineExceeded());
      return;
    }
    this.handle = setTimeout(
      () => {
        this.handle = undefined;
        if (this.closed || this.signal.aborted) return;
        try {
          this.schedule();
        } catch (failure) {
          this.monitorFailed = true;
          this.monitorFailure = failure;
          this.controller.abort(failure);
        }
      },
      Math.min(remaining, 2 ** 31 - 1),
    );
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    let failed = this.monitorFailed;
    let failure = this.monitorFailure;
    for (const cleanup of [
      () => this.stop(),
      () => this.signal.removeEventListener('abort', this.onAbort),
      () => this.controller.close(),
    ]) {
      try {
        cleanup();
      } catch (next) {
        failure = failed
          ? new SuppressedError(next, failure, 'Deadline cleanup failed')
          : next;
        failed = true;
      }
    }
    if (failed) throw failure;
  }
}

export default SynchronousDeadlineOwner;
