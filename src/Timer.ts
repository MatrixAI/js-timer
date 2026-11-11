import type { ContextBodyExit } from '@matrixai/contexts';
import { bracketResource } from '@matrixai/contexts';
import {
  CancellationController,
  PromiseCancellable,
} from '@matrixai/async-cancellable';
import { ErrorTimerEnded } from './errors.js';
import { timestampNow } from './clock.js';
import { normalizeDelay, remainingTime } from './utils.js';

/**
 * Uses the host's native timeout and interval handles.
 * Like native timers, a pending timer keeps the Node event loop alive.
 */
class Timer<T = void> implements PromiseLike<T> {
  /**
   * Delay in milliseconds
   * This may be `Infinity`
   */
  protected _delay: number;

  /** Execution cancellation request; never a claim that the handler stopped. */
  public readonly signal: AbortSignal;

  /**
   * Timestamp when this is constructed
   * Epoch milliseconds from the portable clock.
   * Generated clock readings are weakly monotonic within this module instance.
   */
  public readonly timestamp: Date;

  /**
   * Timestamp when this is scheduled to finish and execute the handler
   * Epoch milliseconds from the portable clock, not a raw relative reading.
   * Resetting with a shorter delay can move this deadline earlier.
   */
  protected _scheduled?: Date;

  /**
   * Handler to be executed
   */
  protected handler?: (signal: AbortSignal) => T | PromiseLike<T>;

  /**
   * Deconstructed promise
   */
  protected p: Promise<T>;

  /**
   * Actual execution outcome, independent of rejection/cancellation of a waiter.
   * Always fulfills with an immutable outcome after the handler has finished,
   * or after pending scheduling has been cancelled without starting a handler.
   */
  public readonly completion: Promise<ContextBodyExit<T>>;

  protected resolveCompletion: (exit: ContextBodyExit<T>) => void;

  /**
   * Resolve deconstructed promise
   */
  protected resolveP: (value: T | PromiseLike<T>) => void;

  /**
   * Reject deconstructed promise
   */
  protected rejectP: (reason?: any) => void;

  /**
   * Abort controller allows immediate cancellation
   */
  protected cancellation: CancellationController;

  /**
   * Internal timeout reference
   */
  protected timeoutRef?: ReturnType<typeof setTimeout>;

  /** Identity of the current schedule; invalidates already-queued callbacks. */
  protected scheduleToken: object = {};

  /**
   * The status indicates when we have started settling or settled
   */
  protected _status: 'settling' | 'settled' | null = null;

  /**
   * Construct a timer with provider-owned cancellation and native completion.
   * Cancellation before execution prevents entry. During execution it requests
   * cooperation; awaiting the timer still observes the actual handler result.
   * Use wait(signal) when only the caller's wait should be abortable.
   */
  constructor(
    handler?: (signal: AbortSignal) => T | PromiseLike<T>,
    delay?: number,
  );
  constructor(opts?: {
    handler?: (signal: AbortSignal) => T | PromiseLike<T>;
    delay?: number;
    signal?: AbortSignal;
  });
  constructor(
    handlerOrOpts?:
      | ((signal: AbortSignal) => T | PromiseLike<T>)
      | {
          handler?: (signal: AbortSignal) => T | PromiseLike<T>;
          delay?: number;
          signal?: AbortSignal;
        },
    delay: number = 0,
  ) {
    let handler: ((signal: AbortSignal) => T | PromiseLike<T>) | undefined;
    let upstream: AbortSignal | undefined;
    if (typeof handlerOrOpts === 'function') {
      handler = handlerOrOpts;
    } else if (typeof handlerOrOpts === 'object' && handlerOrOpts !== null) {
      handler = handlerOrOpts.handler;
      delay = handlerOrOpts.delay ?? delay;
      upstream = handlerOrOpts.signal;
    }
    delay = normalizeDelay(delay);
    this.handler = handler;
    this._delay = delay;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    const cancellation = new CancellationController();
    this.p = new Promise<T>((resolve, reject) => {
      this.resolveP = resolve;
      this.rejectP = reject;
    });
    // Owners may observe only completion; retain rejection without an unhandled
    // result channel while leaving then/catch/wait rejection behavior intact.
    void this.p.catch(() => {});
    this.cancellation = cancellation;
    this.signal = cancellation.signal;
    try {
      this.timestamp = new Date(timestampNow());
      if (isFinite(delay)) {
        const token = this.scheduleToken;
        this.timeoutRef = setTimeout(() => void this.fulfill(token), delay);
        this._scheduled = new Date(this.timestamp.getTime() + delay);
      } else {
        // Infinite scheduling deliberately keeps the host process alive.
        this.timeoutRef = setInterval(() => {}, 2 ** 31 - 1);
      }
      if (upstream != null) cancellation.link(upstream);
      this.signal.addEventListener(
        'abort',
        () => this.reject(this.signal.reason),
        {
          once: true,
        },
      );
      if (this.signal.aborted) this.reject(this.signal.reason);
    } catch (primary) {
      this.scheduleToken = {};
      let failure = primary;
      try {
        clearTimeout(this.timeoutRef);
        delete this.timeoutRef;
      } catch (cleanup) {
        failure = new SuppressedError(
          cleanup,
          failure,
          'Timer setup and scheduler cleanup failed',
        );
      }
      try {
        cancellation.close();
      } catch (cleanup) {
        failure = new SuppressedError(
          cleanup,
          failure,
          'Timer setup and link cleanup failed',
        );
      }
      throw failure;
    }
  }

  public get [Symbol.toStringTag](): string {
    return this.constructor.name;
  }

  public get status(): 'settling' | 'settled' | null {
    return this._status;
  }

  /**
   * Timestamp when this is scheduled to finish and execute the handler
   * Epoch milliseconds from the portable clock, not a raw relative reading.
   * Resetting with a shorter delay can move this deadline earlier.
   */
  public get scheduled(): Date | undefined {
    return this._scheduled == null
      ? undefined
      : new Date(this._scheduled.getTime());
  }

  /**
   * Delay in milliseconds
   * This may be `Infinity`
   */
  public get delay(): number {
    return this._delay;
  }

  /**
   * Gets the remaining time in milliseconds
   * This will return `Infinity` if `delay` is `Infinity`
   * This will return `0` if status is `settling` or `settled`
   */
  public getTimeout(): number {
    if (this._status !== null) return 0;
    if (this._scheduled == null) return Infinity;
    return remainingTime(this._scheduled.getTime(), timestampNow());
  }

  /**
   * To remaining time as a string
   * This may return `'Infinity'` if `this.delay` is `Infinity`
   * This will return `'0'` if status is `settling` or `settled`
   */
  public toString(): string {
    return this.getTimeout().toString();
  }

  /**
   * To remaining time as a number
   * This may return `Infinity` if `this.delay` is `Infinity`
   * This will return `0` if status is `settling` or `settled`
   */
  public valueOf(): number {
    return this.getTimeout();
  }

  /**
   * Cancels the timer
   * Pending scheduling is cancelled. A running handler receives a request and
   * retains ownership until it completes. This method does not await it.
   */
  public cancel(reason?: any): void {
    if (this._status === 'settled') return;
    void this.p.catch(() => {});
    this.cancellation.abort(reason);
  }

  /** Borrow a signal to abandon only this wait, without cancelling execution. */
  public wait(signal?: AbortSignal): Promise<T> {
    if (signal == null) return this.p;
    return bracketResource(
      () => new CancellationController(signal),
      (controller) =>
        PromiseCancellable.from(this.p, { policy: 'early', controller }),
      (controller) => controller.close(),
    );
  }

  /** Retry failed scheduler or upstream listener cleanup after settlement. */
  public retryCleanup(): void {
    if (this._status !== 'settled') throw new Error('Timer is still active');
    const schedulerExit = this.clearSchedule();
    try {
      this.cancellation.close();
    } catch (cleanup) {
      if (schedulerExit.status === 'rejected') {
        throw new SuppressedError(
          cleanup,
          schedulerExit.reason,
          'Timer cleanup retries failed',
        );
      }
      throw cleanup;
    }
    if (schedulerExit.status === 'rejected') throw schedulerExit.reason;
  }

  public then<TResult1 = T, TResult2 = never>(
    onFulfilled?:
      ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onRejected?:
      ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.p.then(onFulfilled, onRejected);
  }

  public catch<TResult = never>(
    onRejected?:
      ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.p.catch(onRejected);
  }

  public finally(onFinally?: (() => void) | undefined | null): Promise<T> {
    return this.p.finally(onFinally);
  }

  /**
   * Refreshes the timer to the original delay and updates the scheduled time.
   * @throws {ErrorTimerEnded} If the timer is `settling` or `settled`
   */
  public refresh(): void {
    if (this._status != null) throw new ErrorTimerEnded();
    return this.reset(this._delay);
  }

  /**
   * Resets the timer with a new delay and updates the scheduled time and delay.
   * @throws {ErrorTimerEnded} If the timer is `settling` or `settled`
   */
  public reset(delay: number): void {
    if (this._status != null) throw new ErrorTimerEnded();
    delay = normalizeDelay(delay);
    // Compute the replacement deadline before disturbing the current schedule.
    const scheduled = isFinite(delay)
      ? new Date(timestampNow() + delay)
      : undefined;
    if (this._status != null) throw new ErrorTimerEnded();
    // A cleared host timer may already have a queued callback. Invalidate it
    // before clearing the handle so it cannot enter the superseded execution.
    const token = (this.scheduleToken = {});
    const cleared = this.clearSchedule();
    if (this._status !== null || token !== this.scheduleToken) return;
    if (cleared.status === 'rejected') {
      this._status = 'settling';
      delete this.handler;
      this.complete(Object.freeze(cleared), {
        status: 'fulfilled',
        value: undefined,
      });
      throw cleared.reason;
    }
    try {
      this.timeoutRef = isFinite(delay)
        ? setTimeout(() => void this.fulfill(token), delay)
        : setInterval(() => {}, 2 ** 31 - 1);
    } catch (reason) {
      if (this._status === null && token === this.scheduleToken) {
        this._status = 'settling';
        delete this.handler;
        this.complete(Object.freeze({ status: 'rejected', reason }), {
          status: 'fulfilled',
          value: undefined,
        });
      }
      throw reason;
    }
    this._delay = delay;
    this._scheduled = scheduled;
  }

  protected async fulfill(token: object): Promise<void> {
    if (this._status !== null || token !== this.scheduleToken) return;
    this._status = 'settling';
    const schedulerExit = this.clearSchedule();
    let exit: ContextBodyExit<T>;
    if (this.handler != null) {
      try {
        const result = await this.handler(this.signal);
        exit = Object.freeze({ status: 'fulfilled', value: result });
      } catch (e) {
        exit = Object.freeze({ status: 'rejected', reason: e });
      }
    } else {
      exit = Object.freeze({ status: 'fulfilled', value: undefined as T });
    }
    delete this.handler;
    this.complete(exit, schedulerExit);
  }

  protected reject(reason?: unknown): void {
    if (this._status === 'settled') return;
    if (this._status === 'settling') {
      // Cancellation requests are not completion. Only the handler's actual
      // outcome may settle execution; an abortable wait is a separate facade.
      return;
    }
    this._status = 'settling';
    this.scheduleToken = {};
    const schedulerExit = this.clearSchedule();
    delete this.handler;
    this.complete(Object.freeze({ status: 'rejected', reason }), schedulerExit);
  }

  protected clearSchedule(): ContextBodyExit<void> {
    if (this.timeoutRef == null) {
      return { status: 'fulfilled', value: undefined };
    }
    const handle = this.timeoutRef;
    const token = this.scheduleToken;
    try {
      clearTimeout(handle);
      if (this.timeoutRef === handle && this.scheduleToken === token) {
        delete this.timeoutRef;
      }
      return { status: 'fulfilled', value: undefined };
    } catch (reason) {
      return { status: 'rejected', reason };
    }
  }

  protected complete(
    exit: ContextBodyExit<T>,
    schedulerExit: ContextBodyExit<void>,
  ): void {
    if (schedulerExit.status === 'rejected') {
      exit = Object.freeze({
        status: 'rejected',
        reason:
          exit.status === 'rejected'
            ? new SuppressedError(
                schedulerExit.reason,
                exit.reason,
                'Timer work and scheduler cleanup failed',
              )
            : schedulerExit.reason,
      });
    }
    try {
      this.cancellation.close();
    } catch (cleanup) {
      exit = Object.freeze({
        status: 'rejected',
        reason:
          exit.status === 'rejected'
            ? new SuppressedError(
                cleanup,
                exit.reason,
                'Timer work and cleanup failed',
              )
            : cleanup,
      });
    }
    this._status = 'settled';
    if (exit.status === 'fulfilled') this.resolveP(exit.value);
    else this.rejectP(exit.reason);
    this.resolveCompletion(exit);
  }
}

export default Timer;
