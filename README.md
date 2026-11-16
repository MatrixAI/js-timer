# js-timer

An awaitable stopwatch/timer with cancellation, handler execution,
reset/refresh, and remaining-time inspection.

## Version 5 migration

Version 5 adopts contexts v4 and async-cancellable v4. Timer execution remains
separate from abortable waiting, and upstream signals can be linked
directionally. Timer completion includes owned scheduler and link cleanup and
reports cleanup failures. Existing version 4 installations retain their original
API.

## Installation and usage

Use a released Git tag when consuming the package.

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
to a finite delay. Reset and refresh reject changes after execution starts. An
optional `signal` in the options links an upstream request without granting
authority over its controller. The link stays owned until execution and cleanup
finish. If clearing a scheduler handle or removing an upstream listener fails,
`completion` retains that failure and `retryCleanup()` can retry cleanup after
settlement. A failed reset after the previous schedule has been invalidated
settles the timer with the failure rather than leaving it pending indefinitely.

Use `timer.wait(signal)` to abandon only one caller's wait. It never cancels the
timer. The always-fulfilled `timer.completion` records the immutable actual
execution outcome; it cannot be cancelled by a waiter. A noncooperative handler
can keep completion pending indefinitely. Native chains do not forward
cancellation automatically.

The previous lazy/eager flags and injected-controller overloads are removed. Use
explicit execution cancellation or waiter cancellation instead. Attaching a
signal listener does not silently select policy. No performance improvement is
claimed by this redesign.

## Composable timer ownership

Timer uses the canonical contexts 4.0.0 scope contract. Applications compose the
provider-owned scope rather than implement timer ownership repeatedly:

```ts
import type { ContextOperation } from '@matrixai/contexts';
import type { TimerContext } from '@matrixai/timer';
import { createTimerScope } from '@matrixai/timer';

const provideTimer = createTimerScope({ delay: 10, handler: () => 7 });
const work: ContextOperation<
  TimerContext<number> & { trace: string },
  string
> = async ({ timer, trace }) => `${trace}:${await timer}`;
const run: ContextOperation<{ trace: string }, string> = provideTimer(work);
const result = await run({ trace: 'application-owned' });
```

Construction is inert. Each execution owns a fresh timer; overlapping calls do
not share timer state. Other context requirements remain the caller's job. This
scope can nest directly with other contexts scopes in application-selected
order. The application still owns retries, supervision, and shutdown policy.

On scope completion, pending scheduling is cancelled and any started handler is
awaited before outer resources may be released. Cancellation requests do not
force a running handler to complete. A handler that never finishes therefore
prevents scope completion; callers must design cooperative termination, not
release live resources on a timeout race.

Successful cleanup preserves the body's exact result or rejection. A handler
failure is a release failure. If both fail, contexts preserves the handler
failure as `SuppressedError.error` and the body failure as
`SuppressedError.suppressed`. Equal values alone cannot prove that failures are
the same occurrence, so both roles are retained even when the body propagates
the timer's own rejection. Pending scheduling cancelled by scope release is
normal cleanup, not an application failure.

The scope does not acquire borrowed timers, supply a cancellation controller, or
interpret a refreshable timer as a fixed deadline. When the outer context has a
signal, the timer borrows it directionally; its handler receives the timer-owned
cancellation signal. Generic cancellation sources, linking, and borrowed waits
come from async-cancellable rather than a second timer-specific cancellation
implementation.

### Functional and method facades

Timing facades adapt the same scope for argument-bearing functions and standard
method decorators. The context argument position is explicit. These adapters
preserve the function signature; a provider field can be optional in that
signature because the scope supplies it for the body.

```ts
import { createTimerScope, createTimingFacades, Timer } from '@matrixai/timer';

type Context = { trace: string; timer?: Timer<number>; signal?: AbortSignal };
const timing = createTimingFacades<Context>()(
  createTimerScope({ delay: 10, handler: () => 7 }),
);

class Worker {
  @timing.method({ context: 1 })
  async run(label: string, context: Context): Promise<string> {
    return `${label}:${context.trace}:${await context.timer!}`;
  }
}

const run = timing.function(
  async (context: Context) => `${context.trace}:${await context.timer!}`,
  { context: 'last' },
);
```

Use the scope directly when the caller-facing operation type should remove the
provided requirement entirely. Scope nesting remains application-selected.

### Named deadline authoring forms

The unreleased named facades select an explicit return protocol and a required
context argument. A fresh finite, nonnegative duration in milliseconds is
required on each entry; it can be a number or a receiver- and argument-dependent
function. A custom clock can be supplied. The default is `timerClock`.

```ts
import { timed, timedCancellable } from '@matrixai/timer/functions';
import { timed as timedMethod } from '@matrixai/timer/decorators';

type Request = { trace: string; signal?: AbortSignal };
const read = timed(async (request: Request) => request.trace, {
  context: 0,
  kind: 'async',
  duration: 1_000,
});
const cancellableRead = timedCancellable(
  async (request: Request) => request.trace,
  {
    context: 0,
    duration: 1_000,
  },
);
class Service {
  @timedMethod({ context: 0, kind: 'sync', duration: 1_000 })
  read(request: Request): string {
    return request.trace;
  }
}
```

`kind` also supports `generator` and `async-generator`. Their budgets begin on
first advancement, not iterator construction. Pre-start return and throw do not
acquire resources. Caller-driven cleanup that yields retains ownership until
another advancement reaches a terminal result. An abandoned iterator may retain
its scheduler and links indefinitely. Overlapping async-generator operations are
rejected; disposal cannot silently drain yielded cleanup.

Plain async timing returns a native promise. Plain generator forms return their
standard iterator protocols. Plain timing's type checks reject visible return
capabilities that its wrapper cannot preserve; the combined method also rejects
extra capabilities beyond its cancellable result. Widening a return type, casts,
or untyped code can bypass these checks; the wrapper does not restore hidden
capabilities. The combined function returns a standard cancellable promise, not
an arbitrary subtype of its body's result. Its invocation-local cancellation
request reaches the supplied context signal but does not automatically cancel an
independently returned cancellable promise; the body must explicitly connect any
such authority when appropriate.

These forms provide a deadline and local signal, not a `Timer` instance. They
borrow any existing timer without changing it. An inherited fixed deadline must
use the same clock and can only shorten the new budget. Expiry requests
cancellation with `ErrorTimerDeadlineExceeded`; it does not force work to
finish. Synchronous calls cannot be preempted by an event-loop timeout. Their
scheduler has synchronous cleanup and does not own an asynchronous timer
handler. The combined function returns a completion-safe cancellable promise;
the standard method decorator cannot change the method's declared TypeScript
return type. A method declared to return a cancellable promise can expose that
capability after decoration. Selected context arguments must be ordinary data
records in finite required argument tuples; overloads and generic signatures are
not preserved generally. For generators with explicitly typed input values,
declare the generator function separately before adapting it; inline expressions
can exceed TypeScript's inference for these context checks.

### Fixed deadlines and relative budgets

`constrainDeadline` and `createDeadlineConstraintScope` intersect finite
absolute constraints from the same clock identity without scheduling or
cancelling work. They use the smaller timestamp and reject incomparable clocks.

`createDeadlineScope` enforces a captured absolute bound with an owned signal
and scheduler; `createTimeoutScope` computes a fresh relative budget on every
entry. Neither widens an inherited deadline. Wrapping a retry loop gives a total
budget; putting the timeout inside that loop gives each attempt a fresh budget,
still bounded by any outer constraint. Expiry requests cancellation, not early
scope completion. Owned scheduling is stopped and monitored work drained on
release. The minimum laws apply to fixed same-clock constraints, not mutable
reset/refresh timers or arbitrary handler executions.

Applications use these scope factories directly; they do not construct the
internal deadline execution owner. The default deadline clock and standalone
timers share one private, weakly monotonic clock per loaded module instance.

### Independently owned deadlines

`DeadlineController` extends `CancellationController`, and is therefore also a
native `AbortController`. Use it when a service or retry manager must own one
fixed deadline independently of any single operation. A relative duration starts
at construction; an optional parent deadline narrows it only when clock
identities match. Consumers borrow the controller's `deadline` and `signal`.

```ts
import { bracketResource } from '@matrixai/contexts';
import { DeadlineController } from '@matrixai/timer';

const results = await bracketResource(
  () => new DeadlineController({ duration: 5_000 }),
  async (controller) => {
    const context = {
      deadline: controller.deadline,
      signal: controller.signal,
    };
    const first = Promise.resolve().then(() => attemptOne(context));
    const second = Promise.resolve().then(() => attemptTwo(context));
    return Promise.allSettled([first, second]);
  },
  async (controller) => {
    let closeFailed = false;
    let closeFailure: unknown;
    try {
      controller.close();
    } catch (reason) {
      closeFailed = true;
      closeFailure = reason;
    }
    const monitoring = await controller.monitoring;
    if (monitoring.status === 'rejected') {
      if (closeFailed)
        throw new SuppressedError(closeFailure, monitoring.reason);
      throw monitoring.reason;
    }
    if (closeFailed) throw closeFailure;
  },
);
```

The attempt promises must represent their work and cleanup. Expiry or upstream
abort requests cancellation; neither joins work nor closes links. `close()`
synchronously disables forwarding and scheduling without aborting the signal;
failed cleanup can be retried. The non-rejecting `monitoring` promise reports
scheduler failure separately from close failures, including a failure after a
reentrant close. `monitoringState` allows synchronous inspection but cannot wait
for an entered callback. The wildcard package exports do not enforce privacy for
the internal deadline owners.

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

The errors dependency remains selected by its released Git tag over SSH.
Contexts selects Git-only `v4.1.0` and cancellation selects `v4.1.1`; the npm
lock pins the exact provider commits. Authorized SSH access is required for
acquisition. Older npm-registry releases do not supply these APIs.

These selections use the existing async-init consumer pattern: the npm lock owns
the exact revision, the Nix source loader selects its prepared archive and
validates the producer descriptors, and native/sandbox installation uses that
archive without rewriting the packed manifest. There is no direct contexts flake
input, second pin, local source override, or extra package lock. Credentials are
not embedded in URLs or archives, and private artifacts must not be uploaded to
a public binary cache without separate authority.

## Development

Use Node.js 24 or newer. The [flake](flake.nix) provides integrated
flake-parts/devenv and [direnv activation](.envrc). Review the configuration and
run `direnv allow .`. The prepared-dependency npm adapter serializes
installation and restores canonical manifests after install-only source
overrides. Activation does not install dependencies, load credentials, or change
persistent shell options. Once activated, install dependencies explicitly and
run project commands directly.

```sh
git submodule update --init --depth 1
nix run './.matrixai/matrixai-standards#skills-materializer' -- --standards-root ./.matrixai/matrixai-standards
npm install
npm run lintfix
npm run build
npm test
npm run lint
```

Local tests build incrementally without cleaning before Vitest runs against
emitted modules, with explicit test imports and standard decorators. All Node
cases, including provider composition, are under `tests/unit` and run with
`npm test`. Arguments pass through. JUnit is written under `tmp/junit`; optional
V8/Cobertura coverage is produced with `npm test -- --coverage`. Use
`npm run lintfix` for active development and `npm run lint` for non-mutating
verification. Documentation is handwritten at the repository root; there is no
TypeDoc dependency, generated documentation directory, or installer test suite.

### Lint and formatting

MatrixAI lint comes from the selected public nixpkgs-matrixai package set, not
an npm dependency or a direct js-lint flake input. One configured tool
environment is shared by the development shell, flake formatter, and independent
hermetic lint check. The bundled CLI owns configuration; TypeScript remains a
consumer development dependency.

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
source provenance. Cancellation, contexts, and errors are advertised as selected
direct runtime providers. Contexts has an empty runtime dependency set; its test
dependencies do not become timer dependencies. Timer remains both a consumer of
prepared archives and a producer of its own archive, with no bundled dependency
tree.

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
routine `unit-js` and independent `lint` gates compose `default`, separate from
`integration-browser` and its `runtime` aggregate. Checks call the same npm
scripts without depending on the active development shell. Successful outputs
retain `report.json` and artifacts.

The independent browser check runs TypeScript Playwright cases in a Chromium
document and dedicated worker against a browser-targeted bundle of the built
timer. It exercises the browser performance clock and host scheduling. Nix
reuses installed test dependencies and the compiled distribution across the
package, unit check, and separately cached browser bundle. Normal tests do not
start a browser. These cases do not establish compatibility with every browser.

The browser check sidecars use a shared library convention: the package build
emits `dist/index.js`, esbuild bundles it as an ES module using the effective
TypeScript build target, and the check supplies its path through
`LIBRARY_BUNDLE`. Playwright discovers test and spec files under
`tests/browser`. Each library supplies its own tests and locks compatible
Playwright and esbuild dependencies. The check uses Nix-provided Chromium
without downloading a browser; Playwright reports missing browser binaries.

The shared browser fixture uses Playwright's isolated page and serves a local,
intercepted document for module workers. Its supporting utilities load the ESM
bundle and clean up workers and object URLs. Capability-specific specs provide
the scenarios and assertions; the fixture and utilities contain no timer
imports. Scenarios are serialized as functions, so they cannot capture local
variables or runtime imports. Return plain serializable data for assertions:
worker results must also support structured cloning. Blob-backed modules can
make source-level debugging less direct than debugging ordinary loaded files.

The compiled distribution and bundle sources exclude tests, specifications,
check adapters, and the Playwright configuration so those changes do not
invalidate either cached result. The package build must not depend on those
excluded inputs. This convention is for browser-compatible libraries; it does
not make Node-only dependencies portable or establish compatibility with
untested browsers.

Run the independent checks from the repository root:

```sh
nix build '.#checks.x86_64-linux.integration-browser'
nix build '.#checks.x86_64-linux.unit-js'
nix build '.#checks.x86_64-linux.lint'
```

The browser and unit checks do not run lint. The unit check uses the shared
compiled distribution via `npm test -- --prebuilt`. Local tests build
incrementally without cleaning; run a clean `npm run build` after source files
are removed or renamed, since incremental compilation does not remove old
output. A flake-wide check evaluates all exposed checks, including lint.

For interactive browser debugging in the activated development shell, build a
local bundle and launch the Playwright inspector:

```sh
npm run build
bash ./nix/checks/browser/bundle.sh
bash ./nix/checks/browser/run.sh --debug
```

Use `--headed` to watch a normal run or `--ui` for Playwright's test UI. These
commands need an available graphical display and headed Chromium; they run
outside the hermetic check, using local dependencies and state.

See [verification evidence](VERIFICATION.md) for executed results. Consumer
updates require a new authorized release/tag. Git-only releases do not publish
to npm; the obsolete tag-triggered npm publisher is removed.
