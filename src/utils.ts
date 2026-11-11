/** Normalize numeric delays to the host timeout range, retaining infinity. */
function normalizeDelay(delay: number): number {
  if (Number.isNaN(delay)) return 0;
  return delay === Infinity
    ? Infinity
    : Math.min(Math.max(delay, 0), 2 ** 31 - 1);
}

/** Calculate a nonnegative whole-millisecond remainder from numeric readings. */
function remainingTime(scheduled: number, now: number): number {
  return Math.max(Math.trunc(scheduled - now), 0);
}

/** Preserve a weakly monotonic timestamp after the clock has been read. */
function monotonicTimestamp(previous: number, current: number): number {
  return Math.max(previous, Math.trunc(current));
}

/** Intersect numeric bounds after their clock and finiteness are validated. */
function earlierDeadline(parent: number, next: number): number {
  return Math.min(parent, next);
}

export { normalizeDelay, remainingTime, monotonicTimestamp, earlierDeadline };
