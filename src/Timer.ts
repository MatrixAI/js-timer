import type { PromiseCancellableController } from '@matrixai/async-cancellable';
import { performance } from 'node:perf_hooks';
import { PromiseCancellable } from '@matrixai/async-cancellable';
import { ErrorTimerEnded } from './errors.js';

/**
 * Just like `setTimeout` or `setInterval`,
 * this will keep the NodeJS event loop alive
 */
class Timer<T = void>
  implements Pick<PromiseCancellable<T>, keyof PromiseCancellable<T>>
{
  /**
   * Delay in milliseconds
   * This may be `Infinity`
   */
  protected _delay: number;

  /**
   * If it is lazy, the timer will not eagerly reject
   * on cancellation if the handler has started executing
   */
  public readonly lazy: boolean;

  /**
   * Timestamp when this is constructed
   * Guaranteed to be weakly monotonic within the process lifetime
   * Compare this with `performance.now()` not `Date.now()`
   */
  public readonly timestamp: Date;

  /**
   * Timestamp when this is scheduled to finish and execute the handler
   * Guaranteed to be weakly monotonic within the process lifetime
   * Compare this with `performance.now()` not `Date.now()`
   */
  protected _scheduled?: Date;

  /**
   * Handler to be executed
   */
  protected handler?: (signal: AbortSignal) => T | PromiseLike<T>;

  /**
   * Deconstructed promise
   */
  protected p: PromiseCancellable<T>;

  /**
   * Resolve deconstructed promise
   */
  protected resolveP: (value?: T) => void;

  /**
   * Reject deconstructed promise
   */
  protected rejectP: (reason?: any) => void;

  /**
   * Abort controller allows immediate cancellation
   */
  protected abortController: AbortController;

  /**
   * Internal timeout reference
   */
  protected timeoutRef?: ReturnType<typeof setTimeout>;

  /**
   * The status indicates when we have started settling or settled
   */
  protected _status: 'settling' | 'settled' | null = null;

  /**
   * Construct a Timer
   * By default `lazy` is false, which means it will eagerly reject
   * the timer, even if the handler has already started executing
   * If `lazy` is true, this will make the timer wait for the handler
   * to finish executing
   * Note that passing a custom controller does not stop the default behaviour
   */
  constructor(
    handler?: (signal: AbortSignal) => T | PromiseLike<T>,
    delay?: number,
    lazy?: boolean,
    controller?: PromiseCancellableController,
  );
  constructor(opts?: {
    handler?: (signal: AbortSignal) => T | PromiseLike<T>;
    delay?: number;
    lazy?: boolean;
    controller?: PromiseCancellableController;
  });
  constructor(
    handlerOrOpts?:
      | ((signal: AbortSignal) => T | PromiseLike<T>)
      | {
          handler?: (signal: AbortSignal) => T | PromiseLike<T>;
          delay?: number;
          lazy?: boolean;
          controller?: PromiseCancellableController;
        },
    delay: number = 0,
    lazy: boolean = false,
    controller?: PromiseCancellableController,
  ) {
    let handler: ((signal: AbortSignal) => T | PromiseLike<T>) | undefined;
    if (typeof handlerOrOpts === 'function') {
      handler = handlerOrOpts;
    } else if (typeof handlerOrOpts === 'object' && handlerOrOpts !== null) {
      handler = handlerOrOpts.handler;
      delay = handlerOrOpts.delay ?? delay;
      lazy = handlerOrOpts.lazy ?? lazy;
      controller = handlerOrOpts.controller ?? controller;
    }
    // Coerce NaN to minimal delay of 0
    if (isNaN(delay)) {
      delay = 0;
    } else {
      // Clip to delay >= 0
      delay = Math.max(delay, 0);
      if (isFinite(delay)) {
        // Clip to delay <= 2147483647 (maximum timeout)
        // but only if delay is finite
        delay = Math.min(delay, 2 ** 31 - 1);
      }
    }
    this.handler = handler;
    this._delay = delay;
    this.lazy = lazy;
    let abortController: AbortController;
    if (typeof controller === 'function') {
      abortController = new AbortController();
      controller(abortController.signal);
    } else if (controller != null) {
      abortController = controller;
    } else {
      abortController = new AbortController();
      abortController.signal.addEventListener(
        'abort',
        () => void this.reject(abortController.signal.reason),
      );
    }
    this.p = new PromiseCancellable<T>((resolve, reject) => {
      this.resolveP = resolve.bind(this.p);
      this.rejectP = reject.bind(this.p);
    }, abortController);
    this.abortController = abortController;
    // If the delay is Infinity, this promise will never resolve
    // it may still reject however
    if (isFinite(delay)) {
      this.timeoutRef = setTimeout(() => void this.fulfill(), delay);
      this.timestamp = new Date(performance.timeOrigin + performance.now());
      this._scheduled = new Date(this.timestamp.getTime() + delay);
    } else {
      // Infinite interval, make sure you are cancelling the `Timer`
      // otherwise you will keep the process alive
      this.timeoutRef = setInterval(() => {}, 2 ** 31 - 1);
      this.timestamp = new Date(performance.timeOrigin + performance.now());
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
   * Guaranteed to be weakly monotonic within the process lifetime
   * Compare this with `performance.now()` not `Date.now()`
   */
  public get scheduled(): Date | undefined {
    return this._scheduled;
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
    return Math.max(
      Math.trunc(
        this._scheduled.getTime() -
          (performance.timeOrigin + performance.now()),
      ),
      0,
    );
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
   * Unlike `PromiseCancellable`, canceling the timer will not result
   * in an unhandled promise rejection, all promise rejections are ignored
   */
  public cancel(reason?: any): void {
    void this.p.catch(() => {});
    this.p.cancel(reason);
  }

  public then<TResult1 = T, TResult2 = never>(
    onFulfilled?:
      | ((value: T, signal: AbortSignal) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onRejected?:
      | ((reason: any, signal: AbortSignal) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
    controller?: PromiseCancellableController,
  ): PromiseCancellable<TResult1 | TResult2> {
    return this.p.then(onFulfilled, onRejected, controller);
  }

  public catch<TResult = never>(
    onRejected?:
      | ((reason: any, signal: AbortSignal) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
    controller?: PromiseCancellableController,
  ): PromiseCancellable<T | TResult> {
    return this.p.catch(onRejected, controller);
  }

  public finally(
    onFinally?: ((signal: AbortSignal) => void) | undefined | null,
    controller?: PromiseCancellableController,
  ): PromiseCancellable<T> {
    return this.p.finally(onFinally, controller);
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
    // This needs to re-create the timeout with the constructor logic.
    clearTimeout(this.timeoutRef);
    // If the delay is Infinity, this promise will never resolve
    // it may still reject however
    this._delay = delay;
    if (isFinite(delay)) {
      this.timeoutRef = setTimeout(() => void this.fulfill(), delay);
      this._scheduled = new Date(
        performance.timeOrigin + performance.now() + delay,
      );
    } else {
      // Infinite interval, make sure you are cancelling the `Timer`
      // otherwise you will keep the process alive
      this.timeoutRef = setInterval(() => {}, 2 ** 31 - 1);
      delete this._scheduled;
    }
  }

  protected async fulfill(): Promise<void> {
    this._status = 'settling';
    clearTimeout(this.timeoutRef);
    delete this.timeoutRef;
    if (this.handler != null) {
      try {
        const result = await this.handler(this.abortController.signal);
        this.resolveP(result);
      } catch (e) {
        this.rejectP(e);
      }
    } else {
      this.resolveP();
    }
    this._status = 'settled';
  }

  protected async reject(reason?: any): Promise<void> {
    if (
      (this.lazy && (this._status == null || this._status === 'settling')) ||
      this._status === 'settled'
    ) {
      return;
    }
    this._status = 'settling';
    clearTimeout(this.timeoutRef);
    delete this.timeoutRef;
    this.rejectP(reason);
    this._status = 'settled';
  }
}

export default Timer;
