import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timer, createTimerScope, errors } from '@matrixai/timer';
import { createContextScope } from '@matrixai/contexts';
import DirectTimer from '@matrixai/timer/Timer.js';

assert.equal(DirectTimer, Timer);
assert.equal(
  JSON.parse(
    readFileSync(
      new URL(import.meta.resolve('@matrixai/timer/package.json')),
      'utf8',
    ),
  ).name,
  '@matrixai/timer',
);
assert.equal(
  JSON.parse(
    readFileSync(
      new URL(import.meta.resolve('@matrixai/timer/Timer.js.map')),
      'utf8',
    ),
  ).version,
  3,
);
const timer = new Timer(() => 7, 1);
assert.ok(Number.isFinite(timer.timestamp.getTime()));
assert.equal(await timer, 7);
assert.equal(timer.status, 'settled');
assert.equal(timer.getTimeout(), 0);
assert.throws(() => timer.refresh(), errors.ErrorTimerEnded);
const pending = new Timer({ delay: Infinity });
assert.equal(pending.getTimeout(), Infinity);
pending.cancel('cancelled');
await assert.rejects(
  Promise.resolve(pending),
  (reason) => reason === 'cancelled',
);
const transaction = createContextScope(async (_outer, body) => body({ transaction: 'tx' }));
const provideTimer = createTimerScope({ delay: 0, handler: () => 7 });
const run = transaction(provideTimer(async ({ timer, transaction, trace }) => {
  assert.equal(timer.signal.aborted, false);
  return `${transaction}:${trace}:${await timer}`;
}));
assert.equal(await run({ trace: 'packed' }), 'tx:packed:7');
