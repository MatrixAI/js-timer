import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import playwrightManifest from '@playwright/test/package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'tmp/integration-browser');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'artifacts'), { recursive: true });
const bundle = await readFile(
  path.join(root, 'tmp/package-candidate/browser.js'),
);
const server = createServer((request, response) => {
  if (request.url === '/browser.js' || request.url === '/worker.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(bundle);
  } else {
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><title>Timer</title><script type="module" src="/browser.js"></script>',
    );
  }
});
let browser;
const results = [];
try {
  if (process.env.CHECK_PLAYWRIGHT_VERSION != null) {
    assert.equal(playwrightManifest.version, process.env.CHECK_PLAYWRIGHT_VERSION,
      'The npm Playwright driver must match the selected Nix browser driver');
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const address = server.address();
  assert(address != null && typeof address !== 'string');
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => globalThis.timerResult != null);
  results.push({
    runtime: 'document',
    ...(await page.evaluate(() => globalThis.timerResult)),
  });
  const workerResult = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker timed out'));
        }, 20000);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
      }),
  );
  results.push({ runtime: 'dedicated-worker', ...workerResult });
  for (const result of results) {
    assert.equal(result.error, undefined);
    assert.equal(result.value, 7);
    assert.equal(result.scopeValue, 'browser:11');
    assert.equal(result.resetValue, 9);
    assert.equal(result.groupValue, '2,3');
    for (const key of [
      'infinite',
      'cancelled',
      'ended',
      'monotonic',
      'remaining',
      'settled',
      'deadlineExpired',
      'waiterIsolated',
      'actualCompleted',
    ]) {
      assert.equal(result[key], true, key);
    }
    assert(Math.abs(Date.now() - result.timestamp) < 60000);
  }
  await writeFile(
    path.join(output, 'artifacts/bundle-inputs.json'),
    await readFile(path.join(root, 'tmp/package-candidate/bundle-inputs.json')),
  );
  await writeFile(
    path.join(output, 'artifacts/cases.json'),
    JSON.stringify(results, null, 2),
  );
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: 'integration-browser',
        kind: 'integration',
        status: 'passed',
        system:
          process.env.CHECK_SYSTEM ?? `${process.arch}-${process.platform}`,
        summary:
          'Packed timer passed in Chromium document and dedicated worker without builtin aliases',
        artifacts: {
          cases: 'artifacts/cases.json',
          bundleInputs: 'artifacts/bundle-inputs.json',
        },
        browser: browser.version(),
        playwright: playwrightManifest.version,
        scope:
          'Local Chromium document and dedicated worker, packed package, no builtin aliases',
        results,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Packed timer passed in Chromium document and dedicated worker\n',
  );
} finally {
  await browser?.close();
  if (server.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
