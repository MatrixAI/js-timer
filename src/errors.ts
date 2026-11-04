import { AbstractError } from '@matrixai/errors';

class ErrorTimer<T> extends AbstractError<T> {
  static description = 'Timer error';
}

class ErrorTimerEnded<T> extends ErrorTimer<T> {
  static description = 'The timer has already ended';
}

class ErrorTimerDeadlineExceeded<T> extends ErrorTimer<T> {
  static description = 'The execution deadline has expired';
}

export { ErrorTimer, ErrorTimerEnded, ErrorTimerDeadlineExceeded };
