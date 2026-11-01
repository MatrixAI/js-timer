/**
 * Internal epoch clock. Capability detection keeps the same emitted module
 * usable in Node, documents, and workers without platform imports or async init.
 */
let lastTimestamp = -Infinity;

function timestampNow(): number {
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
  // Date has millisecond precision. Equality is intentional, not a sequence ID.
  lastTimestamp = Math.max(lastTimestamp, Math.trunc(timestamp));
  return lastTimestamp;
}

export { timestampNow };
