import type * as TimerModule from '@matrixai/timer';
import { expect, test } from './fixture.js';
import { browserRealms } from './utils.js';

for (const realm of browserRealms) {
  test(`uses the performance clock in a ${realm}`, async ({
    browserScenario,
  }) => {
    const result = await browserScenario(
      realm,
      async (library: typeof TimerModule) => {
        const { Timer } = library;
        const before = performance.timeOrigin + performance.now();
        const originalDateNow = Date.now;
        let timer: InstanceType<typeof Timer>;
        try {
          Date.now = () => {
            throw new Error(
              'The performance clock should not use the fallback',
            );
          };
          timer = new Timer(() => 7, 1);
        } finally {
          Date.now = originalDateNow;
        }
        const after = performance.timeOrigin + performance.now();
        const timestamp = timer.timestamp.getTime();
        await timer;
        const later = new Timer(() => 9, 1);
        const monotonic = later.timestamp.getTime() >= timestamp;
        await later;
        return {
          timestamp,
          monotonic,
          performanceClock:
            timestamp >= Math.trunc(before) && timestamp <= Math.trunc(after),
        };
      },
    );
    expect(result.performanceClock).toBe(true);
    expect(result.monotonic).toBe(true);
    expect(Math.abs(Date.now() - result.timestamp)).toBeLessThan(60_000);
  });
}
