import type {
  DeadlineControllerOptions,
  DeadlineMonitoringState,
} from '#index.js';
import type { CancellationController } from '@matrixai/async-cancellable';
import { expectTypeOf, test } from 'vitest';
import { DeadlineController } from '#index.js';

test('deadline controllers preserve native authority and typed monitoring', () => {
  const controller = new DeadlineController({ duration: 10 });
  expectTypeOf(controller).toExtend<AbortController>();
  expectTypeOf(controller).toExtend<CancellationController>();
  expectTypeOf(
    controller.monitoringState,
  ).toEqualTypeOf<DeadlineMonitoringState>();
  const options: DeadlineControllerOptions = { duration: 1 };
  expectTypeOf(options).toExtend<DeadlineControllerOptions>();
  // @ts-expect-error A fixed deadline and duration are mutually exclusive.
  new DeadlineController({
    duration: 1,
    deadline: { clock: { now: () => 0 }, at: 1 },
  });
  controller.close();
});
