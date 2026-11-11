# ADR-001: Nurturing learns from events and keeps its own copies

**Status:** Accepted (2026-09-29; amended 2026-11-11)

**Behavioural contract:** [Nurturing](../specs/nurturing.feature)

**Related:** [ARCHITECTURE.md §9](../../../../dev/docs/ARCHITECTURE.md), a module reacting to a peer's event

## Context

Lifecycle signals to Customer.io and product milestones to PostHog were sent
from inside the modules that own each fact (billing, scenario, workflow, and
others), so every owner carried a peer on billing's nurturing surface. A pull
from the owners was tried and rejected (2026-09-29): "We're event driven so we
don't do that."

## Decision

Nurturing is its own enterprise module and is event driven. It listens to the
owners' events through peer subscribers (`withPeerSubscriber`) and peer folds
(`withPeerFoldProjection`), and keeps what it needs from them in its own
tables. Apart from the one exception below, it never reads another module's
tables and never asks another module's `*Api` for a fact it can learn from an
event. An owner that pushes a fact may still call `NurturingApi.recordSignal`
with a signal from one Zod discriminated union by kind; the command lands
as an event on nurturing's own pipeline, keyed by kind and source event,
and nurturing's subscriber sends it once.

What no event carries is read from the owner's contract at the moment it is
needed and never stored: a person's email and name from `UserApi.findById` when
the signup is sent, and an organization's members and a person's organizations
from `OrganizationApi.getAllMembers` and `organizationIdsForMember`.

One exception remains: `prisma.nurturing-project-directory.repository.ts` reads
the `Project`, `Team` and `Organization` tables directly for a project's
organization, personal owner, first project and organization creation time, and
whether an organization has traced. It is to move to events:
https://github.com/langwatch/tasks/issues/1131.

## Public surfaces and transports

Each package has one root export. Nurturing serves no route: the contract's
`NurturingApi` carries only `recordSignal`.

## Dependencies

The contract holds the signal union, the Customer.io vocabulary, the Api token,
the config (`CUSTOMER_IO_REGION`, the shared `POSTHOG_KEY`/`POSTHOG_HOST`
leaves) and the `CUSTOMER_IO_API_KEY` secret. The process depends on the
`UserApi` and `OrganizationApi` contracts and imports the event schemas of the
owners it listens to. No feature module depends on nurturing's process, so no
peer cycle can pass through it.

## Persistence

Nurturing owns `NurturingProject` and `NurturingOrganizationCreated` (its copies
of project and organization creation), `NurturingOrganization` (admin, milestone
counts, coding signals, last trace), `NurturingProjectUsageView` (one peer fold
row per project and owner) and `NurturingProjectTraceDay` (trace counts per
project and UTC day, kept 30 days). Signals are events on the `nurturing`
pipeline. A delivered signal is claimed in Redis for seven days under the
process-wide idempotency key prefix, so a redelivered event sends nothing.

## Runtime and registration

The Customer.io service and the PostHog client are built in `NurturingModule.create`
only when their key is set; the PostHog client is closed with the process. The
per-project usage folds and subscribers register only with a Customer.io
channel. Owners send the command in any role; the subscribers run in the worker.

## Environment and configuration

Nurturing reads no ambient environment: its config and secret are declared in
the contract and composed by the apps.

## Errors

A sink failure is reported and swallowed, as main's fire-and-forget calls were.
A failed claim throws, and the subscriber is retried.

## Contracts and validation

The signal union and the command are Zod schemas; the owners' events arrive
parsed by their own contracts' schemas.

## Consequences

A signal lags its fact by the owner's event and nurturing's subscriber. Each new
fact costs a peer subscriber or fold and, when it must be kept, a column or
table of nurturing's own; nurturing's copies are only as complete as the events
it has seen. Until the exception above moves to events, nurturing still reads
three tables it does not own.
