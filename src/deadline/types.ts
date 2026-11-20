import type {
  ContextBodyExit,
  ContextDeadlineClock,
  ContextDeadlineConstraint,
} from '@matrixai/contexts';

type DeadlineControllerOptions =
  | {
      deadline: ContextDeadlineConstraint;
      duration?: never;
      clock?: never;
      parentDeadline?: ContextDeadlineConstraint;
      signal?: AbortSignal;
    }
  | {
      duration: number;
      deadline?: never;
      clock?: ContextDeadlineClock;
      parentDeadline?: ContextDeadlineConstraint;
      signal?: AbortSignal;
    };

type DeadlineMonitoringState =
  { readonly status: 'pending' } | ContextBodyExit<void>;

export type { DeadlineControllerOptions, DeadlineMonitoringState };
