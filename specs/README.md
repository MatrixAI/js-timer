# Timer specifications

## Current decisions

- [Timer execution and completion](0002-timer-execution-and-completion/adr.md)
  defines the timer object, scheduling, cancellation, waiting, and completion.
- [Scoped deadlines and timing](0003-scoped-deadlines-and-timing/adr.md) defines
  fixed constraints, timeout budgets, owned timing scopes, and their function
  and method facades.

Acceptance establishes timer-owned intent, not implementation verification,
provider compatibility, or release authority. Requirement and evidence status
are separate. Planned tests and historical receipts are not current proof.

## Proposed decisions

- [Timing authoring facades and iterator ownership](0004-timing-authoring-facades/adr.md)
  proposes named timing and combined cancellation forms, including synchronous
  calls and caller-driven generators. Its requirement-level supersession of the
  current facade clause is conditional on acceptance.
- [Independently owned deadline controller](0005-deadline-controller/adr.md)
  proposes a public deadline and cancellation mechanism with a lifetime
  independent of any one scope, including explicit monitoring and release
  semantics.

## Historical decisions

- [Execution ontology and composition semantics](0001-execution-ontology-and-semantics/adr.md)
  was withdrawn without acceptance. Its broad shared edition, replication rules,
  and planned cases are not binding. Its attached receipt describes a bounded
  historical candidate, not the current package or a released dependency graph.

## Evidence boundaries

Each decision owns its normative clauses. Evidence and case mappings identify
what was actually checked, including the subject revision and provider graph;
they do not replace requirement meaning. Source inspection and historical
candidate results do not establish current installed-provider integration,
browser portability, or Nix package-consumer conformance.

The current
[execution requirements](0002-timer-execution-and-completion/requirements.yml)
and [timing requirements](0003-scoped-deadlines-and-timing/requirements.yml)
index accepted clauses. Their attached case inventories are planned, not proof
of execution. The historical candidate receipt remains unchanged and applies
only to the candidate it identifies.

### Current review inventory

| Boundary                    | Implementation to review                    | Existing test input                                                                                 | Evidence status                                 |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Timer execution and waits   | [Timer](../src/Timer.ts)                    | [Timer cases](../tests/Timer.test.ts), [completion cases](../tests/completion.test.ts)              | Unassessed against current provider APIs        |
| Fixed and relative timing   | [Deadline source](../src/deadline/utils.ts) | [Deadline cases](../tests/deadline/index.test.ts)                                                   | Unassessed against active requirements          |
| Owned timer scope           | [Scope source](../src/context.ts)           | [Scope cases](../tests/context.test.ts)                                                             | Unassessed against active requirements          |
| Function and method facades | [Scope facade factory](../src/utils.ts)     | [Facade cases](../tests/facades.test.ts), [named authoring cases](../tests/functions/index.test.ts) | Named policies and protocol coverage unassessed |
| Runtime boundaries          | [Package entry](../src/index.ts)            | [Browser fixtures](../tests/fixtures/browser/runtime.mjs)                                           | Current released-provider graph not assessed    |

These references identify review inputs, not test-to-requirement bindings. The
historical candidate receipt identifies its own archive hashes and cancellation
revision; its results must not be relabeled as evidence for another revision or
the currently locked dependency graph.

### Local baseline observation

On 2026-11-11, the existing build-first test command passed 42 tests in five
suites against the timer checkout at commit
`bacfcb2cdf3d18de0316cfdffc924ec7f0be97b3`. The installed cancellation package
reported version 3.0.0. This local run did not verify the installed archive's
provenance, the new cancellation provider, browser behavior, or all active
requirements. It is a baseline observation, not a conformance receipt.
