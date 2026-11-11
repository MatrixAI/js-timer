import type { ContextCancellation, ContextOperation, ContextScope } from '@matrixai/contexts';
import type { Timer, TimerContext, DeadlineContext } from '@matrixai/timer';
import { createTimerScope, createTimingFacades, createDeadlineScope, createTimeoutScope, errors } from '@matrixai/timer';
import DirectTimer from '@matrixai/timer/Timer.js';
import { timed, timedCancellable } from '@matrixai/timer/functions';
import { timed as timedMethod } from '@matrixai/timer/decorators';

const timer: Timer<number> = new DirectTimer<number>(
  (signal: AbortSignal) => (signal.aborted ? 0 : 1),
  1,
);
const promise: PromiseLike<number> = timer;
const timestamp: Date = timer.timestamp;
const scheduled: Date | undefined = timer.scheduled;
const error: Error = new errors.ErrorTimerEnded();
void promise;
void timestamp;
void scheduled;
void error;

const provideTimer: ContextScope<Partial<ContextCancellation>, TimerContext<number>> = createTimerScope({
  delay: 1,
  handler: () => 7,
});
const work: ContextOperation<TimerContext<number> & { trace: string }, number> =
  async ({ timer, trace }) => (await timer) + trace.length;
const run: ContextOperation<{ trace: string }, number> = provideTimer(work);
void run({ trace: 'application-owned' });
// @ts-expect-error The provider does not supply application trace data.
void run({});
// @ts-expect-error Numeric handler results cannot supply string timer results.
provideTimer(async (context: TimerContext<string>) => await context.timer);
const inferred: ContextOperation<object, number> = createTimerScope({
  delay: 0, handler: () => 7,
})(async ({ timer }) => await timer);
void inferred;

const clock = { now: () => 0 };
const deadlineScope: ContextScope<Partial<DeadlineContext>, DeadlineContext> =
  createDeadlineScope({ clock, at: 10 });
const deadlineWork: ContextOperation<DeadlineContext & { trace: string }, number> =
  async ({ signal, deadline, trace }) => signal.aborted ? 0 : deadline.at + trace.length;
const deadlineRun: ContextOperation<{ trace: string }, number> = deadlineScope(deadlineWork);
void deadlineRun({ trace: 'application' });
// @ts-expect-error A deadline scope does not supply application trace data.
void deadlineRun({});
const timeoutScope: ContextScope<Partial<DeadlineContext>, DeadlineContext> =
  createTimeoutScope({ duration: 10, clock });
void timeoutScope;
const waited: Promise<number> = timer.wait(new AbortController().signal);
void waited;

type FacadeContext = { signal?: AbortSignal; timer?: Timer<number>; trace: string };
const facades = createTimingFacades<FacadeContext>()(provideTimer);
const adapted = facades.function(async (context: FacadeContext) => context.trace, { context: 0 });
const adaptedResult: Promise<string> = adapted({ trace: 'consumer' });
void adaptedResult;
class Consumer {
  @facades.method({ context: 'last' })
  async run(context: FacadeContext): Promise<number> {
    return await context.timer!;
  }
}
void new Consumer().run({ trace: 'consumer' });
type RefinedTimerContext = { signal?: AbortSignal; timer: Timer<number> & { extra: true } };
// @ts-expect-error The provider cannot satisfy a more specific timer capability.
createTimingFacades<RefinedTimerContext>()(provideTimer);

const named = timed((ctx: { trace: string }) => ctx.trace, { context: 0, kind: 'sync', duration: 1 });
const namedResult: string = named({ trace: 'consumer' });
const cancellableResult = timedCancellable(async (ctx: { trace: string }) => ctx.trace, { context: 0, duration: 1 })({ trace: 'consumer' });
cancellableResult.cancel();
void namedResult;
void cancellableResult;
class NamedConsumer {
  @timedMethod({ context: 0, kind: 'sync', duration: 1 })
  run(ctx: { trace: string }): string { return ctx.trace; }
}
void new NamedConsumer().run({ trace: 'consumer' });
