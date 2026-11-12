import type { Timer as TimerType } from '@matrixai/timer';
import type * as TimerModule from '@matrixai/timer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import playwrightManifest from '@playwright/test/package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../', import.meta.url));
let browserBundle: string;

test.beforeAll(async () => {
  if (process.env.CHECK_PLAYWRIGHT_VERSION != null) {
    expect(playwrightManifest.version).toBe(
      process.env.CHECK_PLAYWRIGHT_VERSION,
    );
  }
  browserBundle = await readFile(
    process.env.TIMER_BROWSER_BUNDLE ??
      path.join(root, 'tmp/integration-browser/browser.js'),
    'utf8',
  );
});

// Playwright serializes this function into the browser or the worker.
async function runBrowserScenario() {
  const {
    Timer,
    createTimerScope,
    createDeadlineScope,
    createTimingFacades,
    errors,
  } = (
    globalThis as typeof globalThis & {
      browserTimer: typeof TimerModule;
    }
  ).browserTimer;
  const before = performance.timeOrigin + performance.now();
  const originalDateNow = Date.now;
  let timer: TimerType<number>;
  try {
    Date.now = () => {
      throw new Error('The performance clock should not use the fallback');
    };
    timer = new Timer<number>((signal) => (signal.aborted ? -1 : 7), 1);
  } finally {
    Date.now = originalDateNow;
  }
  const after = performance.timeOrigin + performance.now();
  const timestamp = timer.timestamp.getTime();
  const value = await timer;
  const reset = new Timer(() => 9, Infinity);
  const infinite = reset.getTimeout() === Infinity && reset.scheduled == null;
  reset.reset(5);
  reset.refresh();
  const remaining = reset.getTimeout();
  const resetValue = await reset;
  const pending = new Timer({ delay: Infinity });
  pending.cancel('cancelled');
  let cancelled = false;
  try {
    await pending;
  } catch (reason) {
    cancelled = reason === 'cancelled';
  }
  let ended = false;
  try {
    timer.refresh();
  } catch (error) {
    ended = error instanceof errors.ErrorTimerEnded;
  }
  const scoped = createTimerScope({ delay: 0, handler: () => 11 });
  const scopeValue = await scoped(
    async ({ timer, trace }: { timer: TimerType<number>; trace: string }) =>
      `${trace}:${await timer}`,
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
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const finishing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const active = new Timer(async () => {
    start();
    await finishing;
    return 13;
  });
  await started;
  const waiter = new AbortController();
  const waiting = active.wait(waiter.signal);
  waiter.abort('leave');
  let waiterIsolated = false;
  try {
    await waiting;
  } catch (reason) {
    waiterIsolated =
      reason === 'leave' &&
      !active.signal.aborted &&
      active.status === 'settling';
  }
  active.cancel('request');
  const retainedExecution = active.status === 'settling';
  finish();
  const completed = await active.completion;
  const actualCompleted =
    retainedExecution &&
    completed.status === 'fulfilled' &&
    completed.value === 13;
  const upstream = new AbortController();
  const linked = new Timer({ delay: Infinity, signal: upstream.signal });
  upstream.abort('upstream');
  const linkedOutcome = await linked.completion;
  type FacadeContext = { timer?: TimerType<number>; signal?: AbortSignal };
  const facade = createTimingFacades<FacadeContext>()(
    createTimerScope({ delay: 0, handler: () => 19 }),
  );
  const facadeValue = await facade.function(
    async (context: FacadeContext) => await context.timer,
    { context: 0 },
  )({});
  return {
    value,
    scopeValue,
    deadlineExpired: deadlineExpired && !parent.signal.aborted,
    waiterIsolated,
    actualCompleted,
    linked:
      linkedOutcome.status === 'rejected' &&
      linkedOutcome.reason === 'upstream',
    facadeValue,
    resetValue,
    infinite,
    cancelled,
    ended,
    timestamp,
    performanceClock:
      timestamp >= Math.trunc(before) && timestamp <= Math.trunc(after),
    monotonic: reset.timestamp.getTime() >= timestamp,
    remaining: remaining >= 0 && remaining <= 5,
    settled: timer.status === 'settled' && timer.getTimeout() === 0,
  };
}

type BrowserResult = Awaited<ReturnType<typeof runBrowserScenario>>;

function checkResult(result: BrowserResult): void {
  expect(result.value).toBe(7);
  expect(result.scopeValue).toBe('browser:11');
  expect(result.resetValue).toBe(9);
  expect(result.facadeValue).toBe(19);
  expect(result.infinite).toBe(true);
  expect(result.cancelled).toBe(true);
  expect(result.ended).toBe(true);
  expect(result.performanceClock).toBe(true);
  expect(result.monotonic).toBe(true);
  expect(result.remaining).toBe(true);
  expect(result.settled).toBe(true);
  expect(result.deadlineExpired).toBe(true);
  expect(result.waiterIsolated).toBe(true);
  expect(result.actualCompleted).toBe(true);
  expect(result.linked).toBe(true);
  expect(Math.abs(Date.now() - result.timestamp)).toBeLessThan(60_000);
}

test('timer uses browser clocks and scheduling in a document', async ({
  page,
}) => {
  await page.addScriptTag({ content: browserBundle });
  checkResult(await page.evaluate(runBrowserScenario));
});

test('timer uses browser clocks and scheduling in a dedicated worker', async ({
  page,
}) => {
  const source = `${browserBundle}\n(${runBrowserScenario.toString()})().then(
    (result) => postMessage({ result }),
    (error) => postMessage({ error: String(error) }),
  );`;
  const result = await page.evaluate(async (workerSource) => {
    const browser = globalThis as unknown as {
      Worker: new (url: string) => {
        onmessage: (event: {
          data: { result?: BrowserResult; error?: string };
        }) => void;
        onerror: (event: { message: string }) => void;
        terminate: () => void;
      };
      URL: {
        createObjectURL: (blob: Blob) => string;
        revokeObjectURL: (url: string) => void;
      };
      Blob: typeof Blob;
    };
    const url = browser.URL.createObjectURL(
      new browser.Blob([workerSource], { type: 'text/javascript' }),
    );
    const worker = new browser.Worker(url);
    try {
      return await new Promise<BrowserResult>((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.error != null) reject(new Error(data.error));
          else if (data.result != null) resolve(data.result);
          else reject(new Error('Worker returned no result'));
        };
        worker.onerror = (event) => reject(new Error(event.message));
      });
    } finally {
      worker.terminate();
      browser.URL.revokeObjectURL(url);
    }
  }, source);
  checkResult(result);
});
