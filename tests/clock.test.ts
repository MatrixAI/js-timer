import { jest } from '@jest/globals';

const originalPerformance = Object.getOwnPropertyDescriptor(
  globalThis,
  'performance',
);
const timers: Array<{ cancel(reason?: unknown): void }> = [];

function setPerformance(value: unknown) {
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  for (const timer of timers.splice(0)) timer.cancel();
  jest.restoreAllMocks();
  if (originalPerformance != null) {
    Object.defineProperty(globalThis, 'performance', originalPerformance);
  } else {
    Reflect.deleteProperty(globalThis, 'performance');
  }
});

describe('portable timer clock', () => {
  test('uses one clock for construction, countdown, reset, and refresh', async () => {
    let relative = 10;
    setPerformance({
      timeOrigin: 1000,
      now() {
        expect(this.timeOrigin).toBe(1000);
        return relative;
      },
    });
    const { Timer } = await import('#index.js');
    const timer = new Timer({ delay: 1000 });
    timers.push(timer);
    expect(timer.timestamp.getTime()).toBe(1010);
    expect(timer.scheduled!.getTime()).toBe(2010);
    relative = 20;
    expect(timer.getTimeout()).toBe(990);
    timer.reset(500);
    expect(timer.scheduled!.getTime()).toBe(1520);
    expect(timer.getTimeout()).toBe(500);
    relative = 30;
    timer.refresh();
    expect(timer.scheduled!.getTime()).toBe(1530);
    expect(timer.timestamp.getTime()).toBe(1010);
  });

  test.each([
    undefined,
    { now: () => 1 },
    { timeOrigin: NaN, now: () => 1 },
    { timeOrigin: 1000, now: () => Infinity },
    { timeOrigin: 8.64e15, now: () => 100 },
  ])(
    'falls back without requiring the Performance API: %p',
    async (performance) => {
      setPerformance(performance);
      jest.spyOn(Date, 'now').mockReturnValue(2000);
      const { Timer } = await import('#index.js');
      const timer = new Timer({ delay: 1000 });
      timers.push(timer);
      expect(timer.timestamp.getTime()).toBe(2000);
      expect(timer.getTimeout()).toBe(1000);
    },
  );

  test('clamps backwards wall-clock changes without increasing remaining time', async () => {
    setPerformance(undefined);
    const wall = jest.spyOn(Date, 'now').mockReturnValue(2000);
    const { Timer } = await import('#index.js');
    const timer = new Timer({ delay: 1000 });
    timers.push(timer);
    wall.mockReturnValue(2100);
    expect(timer.getTimeout()).toBe(900);
    wall.mockReturnValue(1900);
    expect(timer.getTimeout()).toBe(900);
    timer.refresh();
    expect(timer.scheduled!.getTime()).toBe(3100);
  });

  test('handles restricted clocks, infinite delay, and finite reset', async () => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      get() {
        throw new Error('restricted');
      },
    });
    jest.spyOn(Date, 'now').mockReturnValue(2000);
    const { Timer } = await import('#index.js');
    const timer = new Timer({ delay: Infinity });
    timers.push(timer);
    expect(timer.timestamp.getTime()).toBe(2000);
    expect(timer.scheduled).toBeUndefined();
    expect(timer.getTimeout()).toBe(Infinity);
    timer.refresh();
    expect(timer.getTimeout()).toBe(Infinity);
    timer.reset(500);
    expect(timer.scheduled!.getTime()).toBe(2500);
    expect(timer.getTimeout()).toBe(500);
    timer.cancel();
    expect(timer.getTimeout()).toBe(0);
  });
});
