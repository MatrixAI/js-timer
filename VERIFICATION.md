# Verification

## Modernization scope

The timer retains its public constructors, promise/cancellation behavior, native
host scheduling, infinite delays, reset/refresh, and error taxonomy. Its clock
is now synchronous and environment-capability-based throughout construction,
countdown inspection, and rescheduling. Node 24, TypeScript/NodeNext, MatrixAI
lint 1.0.1, Jest/SWC, standards/skills, direnv/devenv, prepared archives, and
the container-style check layout replace the legacy tooling.

TypeDoc and the entire documentation directory are removed. There are no npm
installer tests or unpublished dependency overrides. The initial modernization
was followed by the explicitly authorized Git-only family release.

## Final verification batch

All modernization edits preceded the final lintfix and verification batch. The
following results were executed on 2026-11-01 with Node 24.15.0 on x86_64-linux:

- `npm run lintfix` passed across JavaScript/TypeScript, Markdown, shell, and
  Nix domains in the activated development environment.
- `nix build '.#checks.x86_64-linux.default'` passed. Its shared `npm run check`
  performed typechecking, build-first Jest/SWC tests, non-mutating lint,
  packed-package validation, and the emitted import-boundary audit.
- All 31 unit tests passed: 23 existing timer cases and eight portable-clock
  regression cases. No separate coverage run was performed.
- The packed consumer passed root/submodule imports, export checks,
  resolution/cancellation behavior, canonical manifest comparison, and strict
  declaration compilation with web types and no Node ambient types.
- The emitted graph audit visited 11 modules. Timer source is Node-builtin-free;
  the released errors dependency still imports Node's performance module.
- `nix build '.#npm-package' '.#npm-package-unpacked'` passed. All 15 archive
  files were compared byte-for-byte against the unpacked output; the manifest
  also matches the canonical repository manifest exactly.
- `nix build '.#checks.x86_64-linux.runtime'` failed during the browser bundle
  step because released errors 2.1.3 imports Node's performance module. No
  document or dedicated-worker runtime case executed, so browser compatibility
  is not established.
- The documentation directory is absent, and the lockfile has no TypeDoc
  entries. The package version remains 2.1.1.

The initial final-batch failures were fixture configuration only: the isolated
consumer fixture was excluded from the pre-build repository typecheck, and its
numeric timer generic was made explicit. The corrected routine gate then passed
without changing the public API.

Reports and artifacts remain under `tmp/` for checkout runs and under each
successful check output's root report/artifacts tree. No deployed platform,
alternate browser engine, Windows, or macOS evidence is implied.

## Initial release prerequisite

At modernization time the latest released errors package is 2.1.3, whose clock
still imports Node's performance module. The portable errors changes remain
unreleased. Timer's existing released dependency declarations are preserved; the
full browser graph cannot be claimed portable merely because timer source no
longer imports Node builtins. The named browser lane must expose this transitive
acquisition/runtime boundary rather than add a shim or consume an unpublished
checkout under a released version.

Release and tag the portable errors changes before updating timer's permanent
dependency selection. Then rerun the named browser lane before claiming full
graph portability. Release timer before updating downstream container pins. At
that stage nothing was committed, published, or tagged, and the container
checkout had not been modified by the timer modernization.

## Git-only release 3.0.0

Errors 3.0.0 was released first at revision
`431956c59853f10ff04ba9f604dbaec90f2b6e84`. Timer now selects that Git tag over
SSH and consumes its exact lockfile-selected prepared archive. The new Node 24
minimum is represented by the major version. Packaging relies solely on the
manifest file allowlist; the obsolete npm ignore file and tag-triggered npm
publisher are removed. The final routine and browser gates passed with 31 unit
tests and packed Chromium document/worker resolution, reset/refresh, and
cancellation cases. Both archive outputs built; the emitted graph has no Node
builtin imports. No npm publication is performed.

## Prepared consumer patch 3.0.1

The shared consumer now resolves and temporarily normalizes nested Git
dependency edges for npm's clean-install validation, then restores canonical
constraints. The matching Nix importer normalizes those same temporary edges.
Producer archives and published dependency metadata remain verbatim. The
redundant prepack hook is removed; prepare and explicit Nix builds retain the
existing compilation boundary. Lint uses an explicit SSH Git URI at the
unchanged 1.0.1 tag and revision. Existing 3.0.0 tags remain immutable.

The 3.0.1 patch selects released errors 3.0.1 through its SSH Git tag.
The earlier routine and browser evidence remains historical; final dependency
selection is synchronized before the Git-only patch release.
