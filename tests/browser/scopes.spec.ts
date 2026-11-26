import type { Timer as TimerType } from '@matrixai/timer';
import type * as TimerModule from '@matrixai/timer';
import { expect, test } from './fixture.js';
import { browserRealms } from './utils.js';

for (const realm of browserRealms) {
  test(`provides timing scopes and facades in a ${realm}`, async ({
    browserScenario,
  }) => {
    const result = await browserScenario(
      realm,
      async (library: typeof TimerModule) => {
        const {
          createTimerScope,
          createDeadlineScope,
          createTimingFacades,
          errors,
        } = library;
        const scoped = createTimerScope({ delay: 0, handler: () => 11 });
        const scopeValue = await scoped(
          async ({
            timer,
            trace,
          }: {
            timer: TimerType<number>;
            trace: string;
          }) => `${trace}:${await timer}`,
        )({ trace: 'browser' });
        const parent = new AbortController();
        const deadlineExpired = await createDeadlineScope({
          clock: { now: () => 1 },
          at: 0,
        })(
          async ({ signal }) =>
            signal.aborted &&
            signal.reason instanceof errors.ErrorTimerDeadlineExceeded,
        )({ signal: parent.signal });
        type FacadeContext = {
          timer?: TimerType<number>;
          signal?: AbortSignal;
        };
        const facade = createTimingFacades<FacadeContext>()(
          createTimerScope({ delay: 0, handler: () => 19 }),
        );
        const facadeValue = await facade.function(
          async (context: FacadeContext) => await context.timer,
          { context: 0 },
        )({});
        return {
          scopeValue,
          deadlineExpired: deadlineExpired && !parent.signal.aborted,
          facadeValue,
        };
      },
    );
    expect(result.scopeValue).toBe('browser:11');
    expect(result.deadlineExpired).toBe(true);
    expect(result.facadeValue).toBe(19);
  });
}
