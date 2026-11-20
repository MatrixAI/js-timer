---
title: Scoped deadlines and timing
description: >-
  Fixed constraints, relative budgets, owned scheduling, contexts scopes, and
  equivalent function and standard method-decorator facades.
type: adr
category: architecture
tags: [timer, deadlines, scopes, clocks, decorators]
status: accepted
created: 2026-11-11
updated: 2026-11-11
author: Matrix AI
project: js-timer
technologies: [TypeScript, JavaScript, Node.js]
audience: [developers, maintainers]
---

# ADR-0003: Scoped deadlines and timing

## Status

Accepted. This decision defines timer-owned timing policies and scope
boundaries. Acceptance does not assert that the existing code, candidate
receipts, released providers, or consumers satisfy every active requirement.

## Context

### Background and Problem Statement

A fixed deadline is an absolute bound in a clock domain. It is not a scheduled
callback, an independently cancellable wait, or proof that an operation has
finished. A relative timeout becomes a deadline only at a selected entry time;
restarting a timeout during retry changes the budget. A resettable timer can
move its scheduled time, so fixed-deadline intersection laws do not apply to it.

Contexts provides structural clock, deadline, signal, operation, and scope
contracts, while the timer provider owns concrete clock interpretation,
scheduling, scope cleanup, and handler completion. Cancellation linking and
waiting have separate provider contracts. Applications select scope ordering and
the work they represent. A method decorator is only an authoring facade and must
not introduce another timing or ownership engine.

## Decision Drivers

### Primary Decision Drivers

- Keep fixed constraints, relative budgets, scheduling, and completion distinct.
- Supply reusable scopes without widening inherited deadlines or releasing work
  before its represented completion.

### Secondary Decision Drivers

- Preserve a direct timer object and support functional and standard method
  authoring without duplicating scope semantics.
- Keep clock compatibility and supported runtime boundaries explicit.

## Considered Options

### Option 1: Treat every timer as a mergeable deadline

**Advantages:** One numeric concept appears simple to compose.

**Disadvantages:** Reset, elapsed time, different clock domains, and handler
effects invalidate unrestricted minimum laws.

**Risk Assessment:** High risk of silently widening a constraint or restarting
an expired budget.

### Option 2: Race every operation against a timeout promise

**Advantages:** A caller can return promptly.

**Disadvantages:** Result selection does not stop a running operation or retain
its cleanup and can release resources while they are still in use.

**Risk Assessment:** Unsafe as an implicit owned-scope completion policy.

### Option 3: Separate constraints, owned enforcement, and authoring facades

**Advantages:** Each provider and application can state its own authority,
clock, scope order, and completion boundary.

**Disadvantages:** Callers must choose an explicit scope and waiting policy.

**Risk Assessment:** Bounded by clock injection, deterministic gates, and
installed-provider integration tests.

## Decision

Choose option 3. A pure fixed-constraint operation computes an effective bound
without scheduling. A deadline or timeout scope owns the scheduler and the
directed cancellation link required by its execution. A timer scope owns a fresh
timer and its represented handler completion. Function and standard
method-decorator forms adapt those same scope semantics; they do not create
independent execution policy.

<a id="REQ-TIMER-DEADLINE-001"></a>

### REQ-TIMER-DEADLINE-001 - Fixed constraints preserve clock and bound

Requirement status: active. Level: MUST. Evidence status: unevidenced.

A fixed constraint MUST capture a finite absolute instant and a clock reference.
Combining two fixed constraints with the same clock identity MUST select the
earlier bound; incompatible clock identities MUST be rejected unless an explicit
conversion contract is selected. A captured constraint MUST NOT change when the
caller mutates its input. Constraint composition MUST NOT schedule, read the
clock, cancel work, or acquire a timer.

<a id="REQ-TIMER-DEADLINE-002"></a>

### REQ-TIMER-DEADLINE-002 - Fixed-minimum laws have a bounded domain

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Idempotence, associativity, and commutativity of fixed-deadline intersection
MUST be claimed only for finite absolute bounds in one compatible clock domain.
Those claims MUST NOT be generalized to relative, resettable, refreshed, idle,
or handler-owning timers or to effectful clock reads.

<a id="REQ-TIMER-BUDGET-001"></a>

### REQ-TIMER-BUDGET-001 - Relative budgets begin on scope entry

Requirement status: active. Level: MUST. Evidence status: unevidenced.

A timeout scope MUST capture a finite nonnegative duration and compute a fresh
absolute bound when each execution enters. It MUST intersect that bound with a
compatible inherited fixed deadline without widening it. An already expired
inherited deadline MUST remain expired. Documentation and cases MUST distinguish
a total budget around retries from a fresh budget inside each attempt.

<a id="REQ-TIMER-CLOCK-001"></a>

### REQ-TIMER-CLOCK-001 - Clock and scheduler relationship is explicit

Requirement status: active. Level: MUST. Evidence status: unevidenced.

An enforcing scope MUST document its clock units and required relationship to
the host scheduler, reject invalid clock readings, and recheck the effective
deadline after every scheduler wakeup. Early wakeups and delays beyond the host
maximum MUST NOT cause premature expiry or silently restart a budget. Backward
movement, suspension, throttling, and a clock that does not advance with host
time MUST NOT be described as a guaranteed wall-clock completion bound.

<a id="REQ-TIMER-SCOPE-001"></a>

### REQ-TIMER-SCOPE-001 - Timer scopes retain owned completion

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Constructing a reusable timer scope MUST be inert. Each invocation MUST acquire
an independently owned timer and release only that timer. Scope release MUST
cancel pending scheduling, request cancellation of a started handler, and wait
for represented handler completion and required cleanup before completing. A
borrowed timer MUST NOT be cancelled, reset, refreshed, or released merely
because a body or waiter finishes.

<a id="REQ-TIMER-SCOPE-002"></a>

### REQ-TIMER-SCOPE-002 - Deadline enforcement owns its links and scheduler

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Each enforcing scope invocation MUST own its scheduler and downstream
cancellation source, inherit a supplied upstream signal directionally, and
preserve its first abort reason. Expiry MUST request cancellation with the
documented deadline reason; it MUST NOT itself complete the body or release
resources used by represented work. Pre-aborted or already-expired entry MUST
invoke the body with the resulting aborted signal, not silently start a fresh
budget. Owned links and scheduler handles MUST be released after represented
body completion and on acquisition failure.

<a id="REQ-TIMER-SCOPE-003"></a>

### REQ-TIMER-SCOPE-003 - Scope failure roles remain observable

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Scopes MUST preserve arbitrary body, handler, monitor, and cleanup failure
values and their roles. If body and mandatory cleanup fail, the scope MUST
preserve both through the documented combined failure contract. A failure
already propagated as the same represented occurrence MAY be reported once;
equal values alone MUST NOT silently erase distinct failure occurrences.
Expected cancellation of pending scheduling during normal release MUST NOT be
reported as a new handler failure.

<a id="REQ-TIMER-CONTEXT-001"></a>

### REQ-TIMER-CONTEXT-001 - Scope composition preserves requirements

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Timer scopes MUST use the public contexts operation and scope contracts and
provide only capabilities they actually construct. They MUST preserve unrelated
requirements and union distinctions, and MUST NOT claim to satisfy a stronger
refined signal or deadline solely by supplying its ordinary structural shape.
Each invocation MUST receive its own outer context. Scope composition MUST
retain the caller-selected order; scope nesting MUST NOT be claimed commutative
or idempotent merely because requirement shapes are compatible.

<a id="REQ-TIMER-FACADE-001"></a>

### REQ-TIMER-FACADE-001 - Functions and methods share scope semantics

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Functional timing adapters and standard method decorators MUST delegate to the
same timing scopes and preserve their ordering, result, cancellation,
represented completion, and cleanup semantics. They MUST select the context
argument explicitly, preserve the receiver and all non-context arguments, and
validate unsupported selection at the documented boundary. They MUST NOT depend
on legacy parameter decorators, reflection metadata, or a second resource owner.

<a id="REQ-TIMER-FACADE-002"></a>

### REQ-TIMER-FACADE-002 - Facade evidence covers actual providers

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Runtime and type cases MUST compare functional and decorated timing operations
for supported context positions, receiver-dependent bodies, scope nesting,
overlapping invocations, exact failure identity, cancellation, and gated
completion. A separate installed-declaration consumer MUST verify the published
facade types. Generic contexts facade tests alone MUST NOT be described as proof
of timer integration.

### Required cases

Use injected clocks and controlled wakeups for equal and incompatible clocks,
minimum laws, mutable inputs, already-expired constraints, early wakeups, long
delays, invalid readings, and total versus per-attempt budgets. Gate body and
handler completion to check pre-aborted entry, parent and child direction, scope
cancellation, borrowed timers, cleanup ordering, concurrent invocations, and
body/handler/monitor/cleanup failures. Compare function and standard method
forms against the same scope. Identify each execution and provider revision in
evidence; planned cases are not execution receipts.

## Consequences

### Positive

Applications can compose fixed constraints, owned enforcement, and method
facades without making timeout rejection synonymous with completion.

### Negative

Clock compatibility and actual scope order require deliberate choices. A handler
or body that ignores cancellation can delay scope completion indefinitely.

### Neutral

A pure deadline does not schedule work; an owning scope may schedule a request.
The application selects whether a separate early waiter is appropriate.

## Decision Outcome

Provide explicit fixed constraints, relative budgets, owned timing scopes, and
functional and standard decorator facades over the same semantics.

## Related Decisions

[ADR-0002](../0002-timer-execution-and-completion/adr.md) owns the direct timer
execution and completion contract. The withdrawn shared ontology does not supply
normative obligations to this decision.

## Links

The existing [deadline implementation](../../src/deadline.ts) and
[timer scope](../../src/context.ts) are migration inputs. They do not establish
released-provider integration or satisfaction of the active clauses above. The
[requirement index](requirements.yml) and [planned cases](cases.yml) index the
clauses above; they are not execution receipts.

## More Information

Contexts owns generic structural and resource contracts; cancellation owns
directional links and waiting. Timer owns the concrete scheduling and scope
policies stated here. The relationship does not require access to sibling
specification checkouts in order to interpret this record.

### Upstream review inputs

The following identifiers record reviewed inputs rather than imported
requirements or evidence. Contexts version 4 describes fixed deadlines as
structural capabilities and leaves concrete timing and historical provider
targets to their owners. Timer adopts the policies in this record independently.

| Reviewed input                                                                                | Local treatment                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Contexts ADR-0002, REQ-CONTEXTS-TYPES-001 through 003 and 008                                 | Timer scopes use structural contracts, preserve compatible requirements, and retain explicit execution order. |
| Contexts ADR-0003, REQ-CONTEXTS-OWNERSHIP-007 through 010                                     | Scoped timing retains represented work, release, and failure roles.                                           |
| Contexts ADR-0004, REQ-CONTEXTS-CAPABILITY-002 and deferred REQ-CONTEXTS-TIME-001 through 003 | Timer selects its own fixed-constraint, clock, scheduling, and handler policies.                              |
| Contexts ADR-0007, REQ-CONTEXTS-FACADES-001, 002, 005 through 007                             | Function and method forms share a transformation, explicit selection, and bounded parity evidence.            |
| Cancellation ADR-0005, REQ-CANCEL-CONTROLLER-002 through 004                                  | Enforcing scopes own directional links and retain their cleanup failures.                                     |
| Cancellation ADR-0006, REQ-CANCEL-SCOPE-ENTRY-001 and timer integration review                | Pre-aborted entry reaches the body, while a request alone does not complete represented work.                 |

The withdrawn shared execution ontology is background, not an accepted shared
edition or a replication requirement.

## Audit

### 2026-11-11

**Status:** Pending

**Findings:**

| Finding                      | Files                                                               | Lines      | Assessment                                                        |
| ---------------------------- | ------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| Existing timing scopes       | [Deadline source](../../src/deadline.ts)                            | Whole file | Provider migration and failure review required                    |
| Existing timer scope         | [Scope source](../../src/context.ts)                                | Whole file | Completion and failure policies require current-provider evidence |
| Historical candidate receipt | [Receipt](../0001-execution-ontology-and-semantics/conformance.yml) | Whole file | Partial historical evidence only                                  |

**Summary:** This record accepts timer-owned timing policies without claiming
that source inspection or a historical candidate establishes conformance.

**Action Required:** Bind deterministic and installed-consumer cases to the
active clauses, validate provider versions, and record results by revision.
