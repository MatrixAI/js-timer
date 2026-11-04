import { Timer, errors } from '#index.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve_) => { resolve = resolve_; });
  return { promise, resolve };
}

describe('actual timer completion', () => {
  test('CASE-TIMER-COMPLETION-WAIT: rejected waiting never substitutes for running handler completion', async () => {
    const started = deferred(), finish = deferred();
    const reason = { cancelled: 'wait' }, handlerFailure = { failed: 'handler' };
    const timer = new Timer({ handler: async () => {
      started.resolve();
      await finish.promise;
      throw handlerFailure;
    } });
    let completed = false;
    void timer.completion.then(() => { completed = true; });
    await started.promise;
    const waiter = new AbortController();
    const waiting = timer.wait(waiter.signal);
    waiter.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(timer.signal.aborted).toBe(false);
    timer.cancel(reason);
    expect(timer.signal.reason).toBe(reason);
    expect(timer.status).toBe('settling');
    expect(completed).toBe(false);
    expect(() => timer.reset(1)).toThrow(errors.ErrorTimerEnded);
    finish.resolve();
    const outcome = await timer.completion;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toBe(handlerFailure);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(timer.status).toBe('settled');
    await expect(Promise.resolve(timer)).rejects.toBe(handlerFailure);
  });

  test('CASE-TIMER-COMPLETION-PENDING: cancellation before entry completes without executing a handler', async () => {
    let entered = false;
    const timer = new Timer({ delay: Infinity, handler: () => { entered = true; return 7; } });
    const reason = { cancelled: 'pending' };
    timer.cancel(reason);
    const outcome = await timer.completion;
    expect(outcome).toEqual({ status: 'rejected', reason });
    expect(entered).toBe(false);
    expect(timer.status).toBe('settled');
  });
});
