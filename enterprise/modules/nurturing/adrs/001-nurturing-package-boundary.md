# ADR-001: Owners tell nurturing; nurturing names no peer

**Status:** Accepted (2026-09-29)

**Behavioural contract:** [Nurturing](../specs/nurturing.feature)

**Related:** [ARCHITECTURE.md §9](../../../../dev/docs/ARCHITECTURE.md), a module reacting to a peer's event

## Context

Lifecycle signals to Customer.io and product milestones to PostHog were sent
from inside the modules that own each fact (billing, scenario, workflow, and
others), so every owner carried a peer on billing's nurturing surface. A pull
from the owners was tried and rejected (Alex, 2026-09-29): "We're event driven
so we don't do that."

## Decision

Nurturing is its own enterprise module with no peers. Each owner adds a
subscriber on its own pipeline for the event main reacted to, and calls
`NurturingApi.recordSignal` with a signal from one Zod discriminated union by
kind. The signal carries ids plus what the owner's event holds; nurturing
fetches nothing. The command lands as an event on nurturing's own pipeline,
keyed by kind and source event, and nurturing's subscriber sends it once.

## Amendment (2026-11-08): nurturing projects owner events

**Status:** Proposed, for Alex's review.

The decision above says owners call `NurturingApi.recordSignal` and "nurturing
fetches nothing", and that "the process depends on no feature module". The code
on main already differs: nurturing subscribes to owners' events directly as a
peer (`nurturing.pipeline.ts`, `.withPeerSubscriber`) and reads project placement
through the owners' shares (`NurturingProjectDirectoryRepository`, R40).

The rule is now:

> nurturing may subscribe to and project owner events and read placement through
> shares; it never pulls owner state on a schedule

So the per-email usage is four peer folds in nurturing, one per owner pipeline
(prompt, evaluator, scenario, simulation; a peer fold re-folds from one owner's
log), in `nurturing-project-usage.pipeline.ts`, kept in nurturing's own
`NurturingProjectUsageView` table, one row per project and owner. Evaluations
only mark active days, so a throttled subscriber on `lw.evaluation.lifecycle_completed`
adds at most one day per project a day to an `evaluation` row. Traces are not
copied: trace's existing throttled `lw.trace.trace_received` fact, throttled again
per organization to once per 15 minutes, starts one read of trace's own
`trace_analytics_rollup` through `TraceApi.findTraceUsageByDay`, so nurturing now
depends on `TraceApi` (no cycle: no module depends on nurturing). Each change sums
the organization's projects, listed through the owners' shares, and sends one group
call. The daily pull from the owners' Apis (#9382 before this change) is the thing
still refused: "We're event driven so we don't do that." The trace read is not
that pull: an owner fact starts it, never a schedule.

## Public surfaces and transports

Each package has one root export. Nurturing serves no route: the contract's
`NurturingApi` carries only `recordSignal`.

## Dependencies

The contract holds the signal union, the Customer.io vocabulary, the Api token,
the config (`CUSTOMER_IO_REGION`, the shared `POSTHOG_KEY`/`POSTHOG_HOST`
leaves) and the `CUSTOMER_IO_API_KEY` secret. The process depends on no feature
module, so no peer cycle can pass through it; owners depend on its contract.

## Persistence

Signals are events on the `nurturing` pipeline. A delivered signal is claimed
through the platform's `idempotency` member for seven days, so a redelivered
event sends nothing. No table is owned.

## Runtime and registration

The Customer.io service and the PostHog client are built in `NurturingApp.create`
only when their key is set; the PostHog client is closed with the process.
Owners send the command in any role; the delivery subscriber runs in the worker.

## Environment and configuration

Nurturing reads no ambient environment: its config and secret are declared in
the contract and composed by the apps.

## Errors

A sink failure is reported and swallowed, as main's fire-and-forget calls were.
A failed claim throws, and the subscriber is retried.

## Contracts and validation

The signal union and the command are Zod schemas; the owners' ids arrive typed
through the contract.

## Consequences

A signal lags its fact by the owner's subscriber and nurturing's own. Each new
fact kind costs one union member and one owner subscriber; an attribute main
sent that the owner's event lacks is reported, never fetched.
