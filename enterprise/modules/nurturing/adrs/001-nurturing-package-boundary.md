# ADR-001: Nurturing learns from events and keeps its own copies

**Status:** Accepted (2026-09-29; amended 2026-11-11 and 2026-11-17)

**Behavioural contract:** [Nurturing](../specs/nurturing.feature)

**Related:** [ARCHITECTURE.md §9](../../../../dev/docs/ARCHITECTURE.md), a module reacting to a peer's event

## Context

Lifecycle signals to Customer.io and product milestones to PostHog were sent
from inside the modules that own each fact (billing, scenario, workflow, and
others), so every owner carried a peer on billing's nurturing surface. A pull
from the owners was tried and rejected (2026-09-29): nurturing is event driven.

## Decision

Nurturing is its own enterprise module and is event driven:

- It never reads another module's tables and never calls another module's
  `*Api` for a fact.
- Everything it needs arrives in the owners' events, through peer subscribers
  (`withPeerSubscriber`) and peer folds (`withPeerFoldProjection`), and is kept
  in nurturing's own tables.
- The events follow the existing conventions: each is declared in its owner's
  contract with a Zod schema, typed `lw.<module>.<fact>`, carries its tenant and
  `occurredAt`, and is parsed by that schema on arrival. Each copy is idempotent,
  except the trace-day counts (see Persistence).

An owner that pushes a fact may call `NurturingApi.recordSignal` with a signal
from one Zod discriminated union by kind; the command lands as an event on
nurturing's own pipeline, keyed by kind and source event, and nurturing's
subscriber sends it once.

## Known exceptions on main, tracked

These reads predate the decision and are tracked in
https://github.com/langwatch/tasks/issues/1131:

- `process/src/repositories/prisma/prisma.nurturing-project-directory.repository.ts`
  reads the `Project`, `Team` and `Organization` tables for a project's
  organization, personal owner, first project, organization creation time and
  whether an organization has traced.
- `OrganizationApi.getAllMembers` and `OrganizationApi.organizationIdsForMember`
  in `process/src/services/nurturing-member-facts.service.ts`, and
  `OrganizationApi.getAllMembers` in
  `process/src/services/nurturing-coding-milestones.service.ts`.
- `UserApi.findById` in `process/src/services/nurturing-delivery.service.ts`, for
  a person's email and name when the signup is sent.

## Public surfaces and transports

Each package has one root export. Nurturing serves no route: the contract's
`NurturingApi` carries only `recordSignal`.

## Dependencies

The contract holds the signal union, the Customer.io vocabulary, the Api token,
the config (`CUSTOMER_IO_REGION`, the shared `POSTHOG_KEY`/`POSTHOG_HOST`
leaves) and the `CUSTOMER_IO_API_KEY` secret. The process imports the event
schemas of the owners it listens to, and the `UserApi` and `OrganizationApi`
contracts only for the exceptions above. No feature module depends on
nurturing's process, so no peer cycle can pass through it.

## Persistence

Nurturing owns its copies of the owners' facts: `NurturingProject` (a project's
organization), `NurturingOrganizationCreated` (an organization's creation),
`NurturingOrganizationMember` (memberships), `NurturingOrganizationPlan` (an
organization's plan, folded from billing's `subscription_changed` facts),
`NurturingPersonalProject` (a personal project's owner) and `NurturingTracedProject`
(a project that traced).
It also owns `NurturingOrganization` (admin, milestone counts, coding signals,
last trace), `NurturingProjectUsageView` (one peer fold row per project and
owner), `NurturingProjectTraceDay` (trace counts per project and UTC day, kept 30
days). A redelivered batch can count a trace twice, and so can a root span stored
more than once; accepted (owner decision, issue 9378). Signals are events on the
`nurturing` pipeline. A delivered signal is claimed in Redis for seven days under the process-wide idempotency key prefix,
so a redelivered event sends nothing. Billing's catch-up `subscription_changed` fact, recorded by
`billing:resync-customer-io-plan`, is never claimed. Every `subscription_changed` fact folds into
`NurturingOrganizationPlan` as ADR-174 decision 17 folds billing's facts: the newest billing fact
wins, and a real fact wins a tie. Customer.io hears a fact only when it changes that row, and the row is
written once the calls are sent, so a refused catch-up's retry sends again unless a fact that
beats it landed first.

## Runtime and registration

The Customer.io service and the PostHog client are built in `NurturingModule.create`
only when their key is set; the PostHog client is closed with the process. The
copies' subscribers always register. The per-project usage folds, the trace
counting, the usage sync and the founder's group call on an organization's
creation register only with a Customer.io channel. Owners
send the command in any role; the subscribers run in the worker. The founder's
call carries the name and creation time but no plan, so a replay or retry never
resets a paying organization's plan.
The one exception is the sign-up path, whose group call still sends plan "free" for a
brand-new organization, which has no paid plan yet; that call is claimed once per sign-up.

## Environment and configuration

Nurturing reads no ambient environment: its config and secret are declared in
the contract and composed by the apps.

## Errors

A sink failure is reported and swallowed, as main's fire-and-forget calls were.
A failed claim throws, and the subscriber is retried. A catch-up
`subscription_changed` fact throws instead: a refused call, or no Customer.io
channel (`no_customer_io_channel`), fails its job so it is retried or replayed
(https://github.com/langwatch/tasks/issues/1196).

## Contracts and validation

The signal union and the command are Zod schemas; the owners' events arrive
parsed by their own contracts' schemas.

## Consequences

A signal lags its fact by the owner's event and nurturing's subscriber. Each new
fact costs a peer subscriber or fold and, when it must be kept, a column or
table of nurturing's own. Nurturing's copies are only as complete as the events
it has seen: a project, organization or member that existed before its copy
began is absent until an owner event names it.
