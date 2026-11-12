import { describe, expect, test } from 'vitest';
import {
  earlierDeadline,
  monotonicTimestamp,
  normalizeDelay,
  remainingTime,
} from '#utils.js';

describe('numeric timing calculations', () => {
  test.each([
    [NaN, 0],
    [-Infinity, 0],
    [-1, 0],
    [1.5, 1.5],
    [2 ** 31, 2 ** 31 - 1],
    [Infinity, Infinity],
  ])('normalizes %s to %s', (delay, expected) => {
    expect(normalizeDelay(delay)).toBe(expected);
  });

  test('calculates remaining time and weakly monotonic timestamps', () => {
    expect(remainingTime(12.9, 10)).toBe(2);
    expect(remainingTime(9, 10)).toBe(0);
    expect(monotonicTimestamp(10, 9.9)).toBe(10);
    expect(monotonicTimestamp(10, 12.9)).toBe(12);
  });

  test('intersects validated numeric deadlines', () => {
    expect(earlierDeadline(5, 10)).toBe(5);
    expect(earlierDeadline(20, 10)).toBe(10);
  });
});
