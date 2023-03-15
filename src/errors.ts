import { AbstractError } from '@matrixai/errors';

class ErrorTimer<T> extends AbstractError<T> {
  static description = 'Timer error';
}

class ErrorTimerEnded<T> extends ErrorTimer<T> {
  static description = 'The timer has already ended';
}

export { ErrorTimer, ErrorTimerEnded };
