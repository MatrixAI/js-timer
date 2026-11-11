import type { ContextDeadlineClock } from '@matrixai/contexts';
import { monotonicTimestamp } from './utils.js';

/**
 * Internal epoch clock. Capability detection keeps the same emitted module
 * usable in Node, documents, and workers without platform imports or async init.
 */
const timestampNow = (() => {
  let lastTimestamp = -Infinity;
  return (): number => {
    let timestamp: number | undefined;
    try {
      const performance = globalThis.performance;
      if (
        performance != null &&
        typeof performance.timeOrigin === 'number' &&
        typeof performance.now === 'function'
      ) {
        const candidate = performance.timeOrigin + performance.now();
        if (Number.isFinite(candidate) && Math.abs(candidate) <= 8.64e15) {
          timestamp = candidate;
        }
      }
    } catch {
      // Restricted hosts may expose throwing getters or an unusable clock.
    }
    timestamp ??= Date.now();
    lastTimestamp = monotonicTimestamp(lastTimestamp, timestamp);
    return lastTimestamp;
  };
})();

/** Read and validate an externally supplied clock at the timing boundary. */
function readClock(clock: ContextDeadlineClock): number {
  const now = clock.now();
  if (!Number.isFinite(now)) {
    throw new TypeError('Clock readings must be finite');
  }
  return now;
}

export { timestampNow, readClock };
