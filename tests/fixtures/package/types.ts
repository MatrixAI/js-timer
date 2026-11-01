import type { Timer } from '@matrixai/timer';
import { errors } from '@matrixai/timer';
import DirectTimer from '@matrixai/timer/Timer.js';

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
