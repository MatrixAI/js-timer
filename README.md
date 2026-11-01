# js-timer

An awaitable stopwatch/timer with cancellation, handler execution,
reset/refresh, and remaining-time inspection.

## Installation and usage

```sh
npm install --save 'git+ssh://git@github.com/MatrixAI/js-timer.git#v3.0.0'
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

The existing positional constructor is also supported. Cancellation rejects the
timer with the supplied reason; lazy cancellation waits for a running handler.
Custom controllers retain their existing cancellation policy. Infinite delays
remain pending until cancelled or reset to a finite delay. Reset and refresh
reject changes after the timer starts settling or settles.

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

Timer 3.0.0 selects the released errors 3.0.0 Git tag over SSH. Its lockfile
pins the exact producer revision, and Nix consumes that revision's prepared
archive. Neither an unpublished checkout nor a Node clock alias is used. These
releases are Git-only; an npm registry install without the Git URL selects an
older registry release instead. The named browser check exercises the full
packed dependency graph in document and dedicated-worker realms.

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
source provenance. Errors is advertised as a selected direct runtime provider;
lint remains a development-only prepared dependency. Both archives are selected
from their exact locked Git revisions and validated against their descriptors.
Other registry dependencies retain their integrity-pinned tarballs. Hermetic
installs use importNpmLock with the matching Node installation hook.

The [check layout](nix/checks/default.nix) follows the container repository:
routine `verify` and `default` are separate from `integration-browser` and its
`runtime` aggregate. Checks call the same npm scripts without depending on the
active development shell. Successful outputs retain `report.json` and artifacts.

`npm run check:package` inspects a packed consumer reconstructed from the
lockfile-installed runtime dependency tree; it does not test npm installation.
`npm run check:portable` rejects Node builtins in timer source and reports
transitive builtins separately. It is not a browser execution claim.
`npm run test:browser` attempts a real packed-package Chromium document and
dedicated-worker run without aliases.

See [verification evidence](VERIFICATION.md) for executed results. Consumer
updates require a new authorized release/tag. Git-only releases do not publish
to npm; the obsolete tag-triggered npm publisher is removed.
