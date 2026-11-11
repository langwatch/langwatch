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

## Amendment 2026-11-11: copies of personal owners and traced projects, from owners' facts

**Context.** Nurturing reads two facts it does not own through shares (R40,
`dev/docs/ARCHITECTURE.md` §7, "Shared reads over copies, Postgres too"): who owns a
personal project (`Project.ownerUserId`) and whether an organization ever traced
(`Project.firstMessage`). R40 allows a copy only when a ruling names a reason.

**Ruling (2026-11-11).** Nurturing is to be event driven end to end: what it knows about
another module comes from that module's facts, not from reading its table. That ruling is the
reason R40 asks for.

**Decision.** Nurturing owns two copy tables, written only by its peer subscribers:

- `NurturingPersonalProject` (project id, organization, owner), from organization's
  `personal_team_created` and `personal_workspace_provisioned` and project's
  `personal_owner_listed`;
- `NurturingTracedProject` (project id, organization), from trace's `project_traced` and
  project's `first_message_listed`.

The `listed` facts are sent once by project's background step
`project:list-personal-owner-and-first-message-facts`, after old writers are gone, so history
reaches the copies through events too. Each row is written once and the first write wins: a
personal project's owner never changes and a first message never goes back, so neither order
nor replay can produce a wrong value, and no `lastAppliedEventId` is kept (ADR-179, amendment
2026-10-21). Writing a copy calls no sink.

**Rollout.** Expand, then contract. The first change adds the facts, the tables and the step
and changes no read. A second change switches the owner and has-traced reads to the copies and
removes the shared reads of those two columns, only after the step is done in production and a
before/after count shows no difference.

**Consequences.** Two more tables to keep in step with their facts. A fact whose send fails is
not filled later; its log line is the accepted residue. `ownerUserId` is a kept user id, like
`NurturingOrganization.adminUserId`; neither reacts to an account's erasure yet.
