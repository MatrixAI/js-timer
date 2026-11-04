import type { ContextScopeExit } from '@matrixai/contexts';
import type { Cancellation } from '@matrixai/async-cancellable';
import { createCancellation, waitForPromise } from '@matrixai/async-cancellable';
import { ErrorTimerEnded } from './errors.js';
import { timestampNow } from './clock.js';

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
  public readonly completion: Promise<ContextScopeExit<T>>;

  protected resolveCompletion: (exit: ContextScopeExit<T>) => void;

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
  protected cancellation: Cancellation;

  /**
   * Internal timeout reference
   */
  protected timeoutRef?: ReturnType<typeof setTimeout>;

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
  });
  constructor(
    handlerOrOpts?:
      | ((signal: AbortSignal) => T | PromiseLike<T>)
      | {
          handler?: (signal: AbortSignal) => T | PromiseLike<T>;
          delay?: number;
        },
    delay: number = 0,
  ) {
    let handler: ((signal: AbortSignal) => T | PromiseLike<T>) | undefined;
    if (typeof handlerOrOpts === 'function') {
      handler = handlerOrOpts;
    } else if (typeof handlerOrOpts === 'object' && handlerOrOpts !== null) {
      handler = handlerOrOpts.handler;
      delay = handlerOrOpts.delay ?? delay;
    }
    delay = normalizeDelay(delay);
    this.handler = handler;
    this._delay = delay;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    const cancellation = createCancellation();
    this.p = new Promise<T>((resolve, reject) => {
      this.resolveP = resolve;
      this.rejectP = reject;
    });
    // Owners may observe only completion; retain rejection without an unhandled
    // result channel while leaving then/catch/wait rejection behavior intact.
    void this.p.catch(() => {});
    this.cancellation = cancellation;
    this.signal = cancellation.signal;
    this.signal.addEventListener('abort', () => void this.reject(this.signal.reason), { once: true });
    // If the delay is Infinity, this promise will never resolve
    // it may still reject however
    if (isFinite(delay)) {
      this.timeoutRef = setTimeout(() => void this.fulfill(), delay);
      this.timestamp = new Date(timestampNow());
      this._scheduled = new Date(this.timestamp.getTime() + delay);
    } else {
      // Infinite interval, make sure you are cancelling the `Timer`
      // otherwise you will keep the process alive
      this.timeoutRef = setInterval(() => {}, 2 ** 31 - 1);
      this.timestamp = new Date(timestampNow());
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
    return this._scheduled == null ? undefined : new Date(this._scheduled.getTime());
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
    return Math.max(Math.trunc(this._scheduled.getTime() - timestampNow()), 0);
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
    this.cancellation.cancel(reason);
  }

  /** Borrow a signal to abandon only this wait, without cancelling execution. */
  public wait(signal?: AbortSignal): Promise<T> {
    return waitForPromise(this.p, signal);
  }

  public then<TResult1 = T, TResult2 = never>(
    onFulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onRejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.p.then(onFulfilled, onRejected);
  }

  public catch<TResult = never>(
    onRejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult> {
    return this.p.catch(onRejected);
  }

  public finally(
    onFinally?: (() => void) | undefined | null,
  ): Promise<T> {
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
    // This needs to re-create the timeout with the constructor logic.
    clearTimeout(this.timeoutRef);
    // If the delay is Infinity, this promise will never resolve
    // it may still reject however
    this._delay = delay;
    if (isFinite(delay)) {
      this.timeoutRef = setTimeout(() => void this.fulfill(), delay);
      this._scheduled = new Date(timestampNow() + delay);
    } else {
      // Infinite interval, make sure you are cancelling the `Timer`
      // otherwise you will keep the process alive
      this.timeoutRef = setInterval(() => {}, 2 ** 31 - 1);
      delete this._scheduled;
    }
  }

  protected async fulfill(): Promise<void> {
    if (this._status !== null) return;
    this._status = 'settling';
    clearTimeout(this.timeoutRef);
    delete this.timeoutRef;
    let exit: ContextScopeExit<T>;
    if (this.handler != null) {
      try {
        const result = await this.handler(this.signal);
        this.resolveP(result);
        exit = Object.freeze({ status: 'fulfilled', value: result });
      } catch (e) {
        this.rejectP(e);
        exit = Object.freeze({ status: 'rejected', reason: e });
      }
    } else {
      this.resolveP(undefined as T);
      exit = Object.freeze({ status: 'fulfilled', value: undefined as T });
    }
    delete this.handler;
    this.cancellation.close();
    this._status = 'settled';
    this.resolveCompletion(exit);
  }

  protected async reject(reason?: any): Promise<void> {
    if (this._status === 'settled') return;
    if (this._status === 'settling') {
      // Cancellation requests are not completion. Only the handler's actual
      // outcome may settle execution; an abortable wait is a separate facade.
      return;
    }
    clearTimeout(this.timeoutRef);
    delete this.timeoutRef;
    this.rejectP(reason);
    delete this.handler;
    this.cancellation.close();
    this._status = 'settled';
    this.resolveCompletion(Object.freeze({ status: 'rejected', reason }));
  }
}

function normalizeDelay(delay: number): number {
  if (Number.isNaN(delay)) return 0;
  return delay === Infinity ? Infinity : Math.min(Math.max(delay, 0), 2 ** 31 - 1);
}

export default Timer;
