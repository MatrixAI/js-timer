# js-timer

An awaitable stopwatch/timer with cancellation, handler execution,
reset/refresh, and remaining-time inspection.

## Version 4 compatibility

Version 4 separates execution completion from cancellable waiting and adopts
released contexts v3.0.0 and async-cancellable v3.0.0. Consumers of version 3's
lazy/eager and injected-controller APIs must migrate deliberately; changing
their dependency alone is not sufficient. Existing tags retain their original API.

## Installation and usage

```sh
npm install --save 'git+ssh://git@github.com/MatrixAI/js-timer.git#v4.0.0'
```

```ts
import { Timer } from '@matrixai/timer';

const timer = new Timer({
  delay: 100,
  handler: (signal) => (signal.aborted ? 'cancelled' : 'done'),
});

const remaining = timer.getTimeout();
timer.refresh();
const result = await timer;
```

The two-argument positional constructor is also supported. Cancelling pending
scheduling rejects with the exact reason and prevents handler entry. Cancelling
a running handler requests cooperation; awaiting the timer still observes the
handler's actual result. Infinite delays remain pending until cancelled or reset
to a finite delay. Reset and refresh reject changes after execution starts.

Use `timer.wait(signal)` to abandon only one caller's wait. It never cancels the
timer. The always-fulfilled `timer.completion` records the immutable actual
execution outcome; it cannot be cancelled by a waiter. A noncooperative handler
can keep completion pending indefinitely. Native chains do not forward
cancellation automatically.

The previous lazy/eager flags and injected-controller overloads are removed.
Use explicit execution cancellation or waiter cancellation instead. Attaching a
signal listener does not silently select policy. No performance improvement is
claimed by this redesign.

## Composable timer ownership

Timer uses the canonical contexts 3.0.0 scope contract.
Applications compose the provider-owned scope rather than implement timer
ownership repeatedly:

```ts
import type { ContextOperation } from '@matrixai/contexts';
import type { TimerContext } from '@matrixai/timer';
import { createTimerScope } from '@matrixai/timer';

const provideTimer = createTimerScope({ delay: 10, handler: () => 7 });
const work: ContextOperation<TimerContext<number> & { trace: string }, string> =
  async ({ timer, trace }) => `${trace}:${await timer}`;
const run: ContextOperation<{ trace: string }, string> = provideTimer(work);
const result = await run({ trace: 'application-owned' });
```

Construction is inert. Each execution owns a fresh timer; overlapping calls do
not share timer state. Other context requirements remain the caller's job.
This scope can nest directly with other contexts scopes in application-selected
order. The application still owns retries, supervision, and shutdown policy.

On scope completion, pending scheduling is
cancelled and any started handler is awaited before outer resources may be
released. Cancellation requests do not force a running handler to complete.
A handler that never finishes therefore prevents scope completion; callers must
design cooperative termination, not release live resources on a timeout race.

Successful cleanup preserves the body's exact result or rejection. A handler
failure not already propagated by the body is a release failure. If both fail,
contexts preserves the handler failure as `SuppressedError.error` and the body
failure as `SuppressedError.suppressed`. The identical propagated handler failure
is not reported twice. Pending scheduling cancelled by scope release is normal
cleanup, not an application failure.

The scope does not acquire borrowed timers, supply a cancellation controller,
link a parent signal, or interpret a refreshable timer as a fixed deadline.
Its handler receives the timer-owned cancellation signal. Generic cancellation
sources, linking, and borrowed waits come from async-cancellable rather than a
second timer-specific cancellation implementation.

### Fixed deadlines and relative budgets

`constrainDeadline` and `createDeadlineConstraintScope` intersect finite absolute
constraints from the same clock identity without scheduling or cancelling work.
They use the smaller timestamp and reject incomparable clocks.

`createDeadlineScope` enforces a captured absolute bound with an owned signal and
scheduler; `createTimeoutScope` computes a fresh relative budget on every entry.
Neither widens an inherited deadline. Wrapping a retry loop gives a total budget;
putting the timeout inside that loop gives each attempt a fresh budget, still
bounded by any outer constraint. Expiry requests cancellation, not early scope
completion. Owned scheduling is stopped and monitored work drained on release.
The minimum laws apply to fixed same-clock constraints, not mutable reset/refresh
timers or arbitrary handler executions.

## Portable clock and host timers

Timer source uses the global Performance API when usable, with a synchronous
wall-clock fallback for missing, incomplete, restricted, non-finite, or
out-of-range clocks. Construction, remaining-time reads, and reset/refresh all
use the same internal clock. There are no Node builtin imports in timer source,
no asynchronous clock initialization, and no separate runtime-specific builds.

Timestamps and deadlines are epoch milliseconds, not raw relative performance
readings. Clock readings are weakly nondecreasing within one loaded clock module
instance. Millisecond precision permits equality. A backwards wall-clock change
can pause the estimated countdown until the clock catches up. This is not a
cross-worker/process clock, a unique ID, or a promise of accurate elapsed time
when falling back to a wall clock. A shorter reset delay may move a deadline
earlier; the creation timestamp does not change.

Scheduling still uses the host's native timeouts/intervals. Browser numeric
handles and Node timer objects do not require separate implementations. Host
scheduling delays, throttling, suspension, and clock precision remain outside
the timer's control. Pending timers keep the Node event loop alive like native
timers. Remaining time becomes zero once settling begins, even if a handler has
not completed.

### Released dependency boundary

The errors dependency remains selected by its released Git tag over SSH. The
contexts dependency selects the private Git-only `v3.0.0` release; the npm lock
pins its exact commit `dc958bdffdd535cd347d9fe6f800d91177ede341`. Cancellation
selects its Git-only `v3.0.0` release at
`8566e758e19d18fbd729af28f21a770768d5dcdc`. Authorized SSH access is required
for acquisition. Older npm-registry releases do not supply these APIs.

These selections use the existing async-init consumer pattern: the npm lock owns
the exact revision, the Nix source loader selects its prepared archive and
validates the producer descriptors, and native/sandbox installation uses that
archive without rewriting the packed manifest. There is no direct contexts
flake input, second pin, local source override, or extra package lock. Credentials
are not embedded in URLs or archives, and private artifacts must not be uploaded
to a public binary cache without separate authority.

For explicit local provider experiments, `npm run check:candidate --
/absolute/cancellation.tgz --browser` creates an isolated consumer with a
generated dependency edge. Add `--lifecycle-root /absolute/async-init-checkout`
after that checkout's packed-package check to exercise admission, race losers,
timer cleanup, and service stop ordering. This optional lane preserves the
lifecycle package's own locked dependency scopes. It is not the canonical
dependency-selection or release gate, and its generated archive is not a release.

## Development

Use Node.js 24 or newer. The [flake](flake.nix) provides integrated
flake-parts/devenv and [direnv activation](.envrc). Review the configuration and
run `direnv allow .`. The prepared-dependency npm adapter serializes
installation and restores canonical manifests after install-only source
overrides. Activation does not load credentials or change persistent shell
options. Once activated, run project commands directly.

```sh
git submodule update --init --depth 1
nix run './.matrixai/matrixai-standards#skills-materializer' -- --standards-root ./.matrixai/matrixai-standards
npm run lintfix
npm run build
npm run typecheck
npm test -- --runInBand
npm run check:package
npm run check:portable
npm run check
```

Tests compile first and use Jest/SWC in ESM mode against emitted modules.
Arguments pass through `npm test`. JUnit is written under `tmp/junit`; optional
V8/Cobertura coverage is produced with `npm test -- --runInBand --coverage`. Use
`npm run lintfix` for active development and `npm run lint` for non-mutating
verification. Documentation is handwritten at the repository root; there is no
TypeDoc dependency, generated documentation directory, or installer test suite.

### Lint and formatting

MatrixAI lint comes from the selected public nixpkgs-matrixai package set, not
an npm dependency or a direct js-lint flake input. One configured tool
environment is shared by the development shell, flake formatter, and independent
hermetic lint check. The bundled CLI owns configuration; TypeScript remains a
consumer development dependency. The packaged-consumer type fixture is compiled
independently by `npm run check:package`, not against the main lint TypeScript
project.

```sh
nix fmt
npm run lintfix
npm run lint
nix build '.#checks.x86_64-linux.lint'
```

The first two commands share the formatting authority across applicable domains,
including TypeScript, Markdown, shell, and Nix. The last two are non-mutating
verification; the Nix lint gate works without an activated development shell.

## Prepared package and hermetic checks

```sh
nix build '.#npm-package'
nix build '.#npm-package-unpacked'
nix build '.#checks.x86_64-linux.default'
nix build '.#checks.x86_64-linux.runtime'
```

The default package and `npm-package` are the archive file itself. The unpacked
output contains the exact package contents at its root. Compiled ESM,
declarations, source maps, canonical metadata, README, and license are included;
dependencies, Node, and Nix paths are not bundled into the package metadata.
Source and packed manifests preserve dependency declarations and lifecycle
scripts verbatim.

Schema-v1 package/distribution descriptors expose manifest metadata and honest
source provenance. Cancellation, contexts, and errors are advertised as selected direct runtime
providers. Contexts has an empty runtime dependency set; its test dependencies
do not become timer dependencies. Timer remains both a consumer of prepared
archives and a producer of its own archive, with no bundled dependency tree.

The npm lock, not distribution metadata, owns the transitive dependency graph.
Select each required Git-backed dependency at its concrete locked module path;
nested copies may select different revisions. The shared installer and sandbox
adapter resolve edges from the nearest package scope, normalize only temporary
installation constraints, and restore canonical manifests. Unprepared Git
dependencies fail closed in the sandbox. Runtime-provider advertisements do not
silently acquire packages, deduplicate versions, or change a consumer's lock.
Lint is supplied separately by the package set. Registry dependencies retain
their integrity-pinned tarballs. Hermetic installs use importNpmLock with its
matching Node installation hook.

The [check layout](nix/checks/default.nix) follows the container repository:
routine `verify` and independent `lint` gates compose `default`, separate from
`integration-browser` and its `runtime` aggregate. Checks call the same npm
scripts without depending on the active development shell. Successful outputs
retain `report.json` and artifacts.

`npm run check:package` inspects a packed consumer reconstructed from the
lockfile-installed runtime dependency tree; it does not test npm installation.
`npm run check:portable` rejects Node builtins in timer source and reports
transitive builtins separately. It is not a browser execution claim.
`npm run test:browser` attempts a real packed-package Chromium document and
dedicated-worker run without aliases.

See [verification evidence](VERIFICATION.md) for executed results. Consumer
updates require a new authorized release/tag. Git-only releases do not publish
to npm; the obsolete tag-triggered npm publisher is removed.
