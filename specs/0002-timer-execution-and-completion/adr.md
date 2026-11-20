---
title: Timer execution and completion
description: >-
  An owned timer separates scheduling, cancellation, waiting, represented
  handler work, and actual completion.
type: adr
category: architecture
tags: [timer, scheduling, cancellation, ownership, completion]
status: accepted
created: 2026-11-11
updated: 2026-11-11
author: Matrix AI
project: js-timer
technologies: [TypeScript, JavaScript, Node.js]
audience: [developers, maintainers]
---

# ADR-0002: Timer execution and completion

## Status

Accepted. This record specifies timer-owned behavior, not release readiness or
proof that every active requirement is implemented. Evidence is assessed
separately for the implementation and its selected provider revisions.

## Context

### Background and Problem Statement

A timer schedules a handler and may also expose a promise-like result. A request
to stop, a caller abandoning its wait, a handler settling, and an owner
finishing mandatory cleanup are different events. A running handler may ignore a
request; releasing a resource used by that handler merely because a waiter
rejected is unsafe. A promise cannot represent detached work that its handler
did not return.

An earlier API offered eager and lazy cancellation and custom controller
callbacks. Those options mix selection of a caller-facing result with ownership
and do not express the duration of represented handler work. The timer object
remains useful, but its cancellation and completion boundaries need explicit
contracts. The existing implementation is a migration baseline, not proof that
the new provider versions or every failure path satisfy this record.

### Vocabulary

The timer owns its scheduler handle and its execution cancellation source. A
borrowed upstream signal conveys a request and reason, not authority to abort
its source. Represented handler work is the handler's returned value or
thenable; detached effects are outside this boundary. Actual completion is
represented work settlement plus mandatory timer-owned cleanup. A waiter
observes a result and may stop waiting without owning or completing that work.

## Decision Drivers

### Primary Decision Drivers

- Retain a usable timer object with reset and refresh while scheduling is
  pending.
- Preserve represented work and cleanup independently of cancellation and waits.

### Secondary Decision Drivers

- Reuse the public cancellation provider without granting upstream authority.
- Keep native scheduler behavior and cross-runtime limitations explicit.

## Considered Options

### Option 1: Eagerly reject and treat rejection as completion

**Advantages:** Callers receive a prompt result on cancellation.

**Disadvantages:** A started handler can continue to use owned resources after
the result settles.

**Risk Assessment:** Unsafe if the rejection is treated as a release boundary.

### Option 2: Remove the timer object and expose only timing scopes

**Advantages:** One scope-oriented surface.

**Disadvantages:** Removes useful direct scheduling, inspection, and reset APIs.

**Risk Assessment:** Unnecessary compatibility and usability loss.

### Option 3: Own completion and provide a separate borrowed wait

**Advantages:** The timer remains directly usable while its owner can retain
actual completion, and a waiter can leave without cancelling the timer.

**Disadvantages:** Callers must choose and retain the correct boundary.

**Risk Assessment:** Bounded by explicit state, cancellation, and cleanup tests.

## Decision

Choose option 3. The public timer object owns one execution, its scheduling
handle, and its cancellation state. It exposes a completion-bearing result and a
separate way to abandon a borrowed wait. Scopes may own a timer but do not alter
the meaning of its completion. Fixed deadlines and scope composition are defined
separately in [ADR-0003](../0003-scoped-deadlines-and-timing/adr.md).

<a id="REQ-TIMER-OBJECT-001"></a>

### REQ-TIMER-OBJECT-001 - One timer owns one execution

Requirement status: active. Level: MUST. Evidence status: unevidenced.

The public timer object MUST own one scheduling execution and its represented
handler work. It MUST expose its cancellation signal, an awaitable execution
result, and an owner-observable completion outcome. The completion outcome MUST
remain observable independently of any individual wait and represent handler
settlement and mandatory timer-owned cleanup. Detached work is not included.

<a id="REQ-TIMER-SCHEDULE-001"></a>

### REQ-TIMER-SCHEDULE-001 - Scheduling has one entry winner

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Pending cancellation MUST clear owned scheduling and prevent handler entry. A
handler that has begun MUST be invoked at most once. The timer MUST serialize
expiry, reset, refresh, and cancellation so stale scheduler callbacks cannot
start the handler after cancellation or a superseding schedule. Setup failure
MUST unwind any acquired handle and installed owned links.

<a id="REQ-TIMER-CANCELLATION-001"></a>

### REQ-TIMER-CANCELLATION-001 - Requests do not force running work to finish

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Before handler entry, cancellation MUST reject the execution with the request's
exact reason. After entry, cancellation MUST request cooperation through the
handler signal without replacing the handler's eventual result or claiming it
has stopped. Repeated requests MUST retain the first native abort reason. A
request without an explicit reason follows native abort semantics.

<a id="REQ-TIMER-LINK-001"></a>

### REQ-TIMER-LINK-001 - Borrowed cancellation is directional

Requirement status: active. Level: MUST. Evidence status: unevidenced.

When the timer accepts an upstream signal, it MUST propagate pre-existing and
later aborts to its owned source with exact reason identity. Cancelling the
timer MUST NOT abort the upstream source. The timer MUST own its link and
attempt to remove it after represented work and mandatory cleanup, including
partial setup failure; an abandoned wait MUST NOT unlink active execution. If
physical listener removal fails, the owner MUST disable forwarding, report the
failure, and retain the ability to retry removal. Supplying a signal MUST NOT
silently transfer controller authority.

<a id="REQ-TIMER-WAIT-001"></a>

### REQ-TIMER-WAIT-001 - A borrowed waiter cannot cancel execution

Requirement status: active. Level: MUST. Evidence status: unevidenced.

An abortable timer wait MUST borrow its input signal and reject only that wait
when the signal aborts. It MUST NOT cancel, reset, release, or report completion
of the timer. Late handler rejection MUST remain handled and available through
the owner's execution or completion outcome. A waiter listener MUST be removed
after its own settlement, including setup failure.

<a id="REQ-TIMER-COMPLETION-001"></a>

### REQ-TIMER-COMPLETION-001 - Completion retains failures

Requirement status: active. Level: MUST. Evidence status: unevidenced.

The owner-observable outcome MUST retain the actual fulfillment or rejection,
including arbitrary rejection values, after mandatory cleanup. If work and
cleanup both fail, the documented outcome MUST preserve both failure values and
their roles. Waiting for the timer's completion-bearing execution result MUST
NOT succeed or fail early merely because a cancellation request was made after
handler entry. Non-cooperative work may keep completion pending indefinitely.

<a id="REQ-TIMER-RESET-001"></a>

### REQ-TIMER-RESET-001 - Reset and refresh reschedule pending execution

Requirement status: active. Level: MUST. Evidence status: unevidenced.

Reset and refresh MUST operate only before handler entry or cancellation wins.
They MUST retain the same execution, cancellation source, and completion
outcome, replacing only owned scheduling and its associated deadline. After
entry or completion they MUST fail deliberately. The API MUST document delay
normalization, infinite delay, native scheduler limits, and event-loop liveness.

<a id="REQ-TIMER-PORTABILITY-001"></a>

### REQ-TIMER-PORTABILITY-001 - Runtime and clock boundaries are explicit

Requirement status: active. Level: MUST. Evidence status: unevidenced.

The timer MUST operate with native host scheduling in its supported Node,
browser document, and worker environments without importing Node-only runtime
modules. Clock units, fallback behavior, precision, backward movement, native
throttling, and infinite-delay liveness MUST be documented. Clock identity alone
MUST NOT be described as proof of synchronization or monotonicity.

### Required cases

Use controlled scheduler callbacks and gated handler work to cover pending and
running cancellation, pre-aborted and later upstream requests, reason identity,
stale callbacks, reentrant reset, setup and cleanup failures, and a handler that
ignores cancellation. Verify separate wait abandonment and late failure,
completion after cleanup, finite and infinite delay, and post-entry reset
rejection. Test installed package declarations and each supported runtime as
distinct evidence, not as consequences of source typechecking.

## Consequences

### Positive

Callers retain direct timer ergonomics without confusing an early wait with
handler completion.

### Negative

Earlier eager/lazy and controller-callback APIs require explicit migration.
Non-cooperative handlers can delay completion and scope release indefinitely.

### Neutral

An application may choose an early wait, but its owner remains responsible for
the original completion-bearing execution.

## Decision Outcome

Keep the timer object and make scheduling, cancellation, waiting, and owned
completion independently observable under the requirements above.

## Related Decisions

[ADR-0003](../0003-scoped-deadlines-and-timing/adr.md) defines the scoped timing
and fixed-constraint boundaries. The earlier shared ontology was withdrawn and
does not supply normative clauses to this decision.

## Links

The [timer implementation](../../src/Timer.ts) and its tests are implementation
surfaces, not independent evidence that all active obligations are satisfied.
The [requirement index](requirements.yml) and [planned cases](cases.yml) index
the clauses above; they are not execution receipts.

## More Information

Upstream contexts and cancellation providers own their respective generic
resource, signal-link, and waiting contracts. Timer independently owns the
scheduling and completion policies stated here.

### Upstream review inputs

The following identifiers record reviewed inputs, not imported normative text or
proof of integration. Contexts version 4 owns its resource bracket and
structural signal capability; its deferred provider targets do not bind this
repository. The cancellation provider owns its accepted controller and waiting
policies.

| Reviewed input                                                           | Local treatment                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Contexts ADR-0003, REQ-CONTEXTS-OWNERSHIP-007 through 010                | Timer specifies its own represented completion, cleanup, failure, and thenable boundaries. |
| Contexts ADR-0004, REQ-CONTEXTS-CAPABILITY-001                           | Timer distinguishes signal observation from authority and completion.                      |
| Cancellation ADR-0005, REQ-CANCEL-CONTROLLER-002 through 004             | Timer owns directional links and observes setup and release failures.                      |
| Cancellation ADR-0006, timer integration review and waiting requirements | Timer independently selects completion-safe handler execution and a borrowed early wait.   |

These inputs are informative provenance. This decision is independently
interpretable and does not require sibling repositories to validate it.

## Audit

### 2026-11-11

**Status:** Pending

**Findings:**

| Finding                      | Files                                                               | Lines      | Assessment                                               |
| ---------------------------- | ------------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Existing timer execution     | [Timer](../../src/Timer.ts)                                         | Whole file | Baseline requires provider migration and detailed review |
| Historical candidate receipt | [Receipt](../0001-execution-ontology-and-semantics/conformance.yml) | Whole file | Partial historical evidence, not current conformance     |

**Summary:** Decision acceptance is separate from implementation and released
provider verification. The earlier candidate does not establish this record's
active requirements.

**Action Required:** Map each requirement to executable cases and revision-
attributed results; verify the released provider graph and supported runtimes.
