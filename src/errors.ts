import ErrorTimer from '@/ErrorTimer';

class ErrorTimerEnded<T> extends ErrorTimer<T> {
  static description = 'The timer has already ended';
  exitCode = 70; // SOFTWARE error
}

export { ErrorTimer, ErrorTimerEnded };
