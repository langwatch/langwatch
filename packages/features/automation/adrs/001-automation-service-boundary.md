# Automation service boundary

**Status:** Accepted

**Behavioural contract:** [Automation ownership](../specs/automation.feature)

## Decision

Trigger definitions, trigger-fire history, report schedules, action delivery
orchestration, and email suppression are subordinate subjects of one singular
`automation` feature. Other features consume only
the `AutomationService` capability from the contract package. Persistence is
private to the server package and is supplied through repository ports and
composition adapters.

Provider schemas, sentinels, action vocabulary, and reusable templating live in
the automation contract. The former standalone provider package is retired;
it is not a second service or domain abstraction.

## Context

Triggers, delivery actions, fire history, and unsubscribe state currently share
one product lifecycle but were split across application folders and a small
provider package. A single ownership root prevents transports from selecting a
second repository or constructing request-scoped services.

## Public surfaces and transports

The existing `/api/triggers` and unsubscribe URLs remain compatibility
transports. They delegate to the composed Automation/Trigger service and do not
change their wire shape in this extraction.

## Dependencies

The contract depends on Zod 4.4.3 and the portable `croner` validator used by
report schedules. Server services depend on their own repositories and
injected token/database capabilities. No feature imports another feature's
repository or concrete service.

## Persistence

Trigger, TriggerSent, and EmailSuppression rows are private to server
repositories. Prisma-shaped database access enters through
`AutomationDatabase`; callers do not pass a global Prisma client to handlers.

## Runtime and registration

`PrismaAutomationAdapter` exposes explicit static construction for the process
composition root. Importing the package does not register routes or create
services.

## Environment and configuration

The feature reads no environment variables. Token verification, mail delivery,
schedulers, and external providers are injected as capabilities by the host.

## Errors

Missing automations and triggers throw concrete contract errors. Optional
discovery uses `try*` names; invalid unsubscribe tokens use the dedicated
`InvalidUnsubscribeTokenError` so transports can preserve their 4xx mapping.

## Contracts and validation

Portable trigger, action, cadence, provider, fire-history, and suppression
values are Zod 4 schemas. Repository adapters map database rows at the feature
boundary, so Prisma types do not leak through contract or web exports.

## Consequences

Trigger, fire-history, report-schedule, and email-suppression lifecycles share
one process-owned service capability and one ownership root. Compatibility
transports keep their existing URLs while mapping their inputs to that
capability. Repository and scheduler details remain private, so callers cannot
silently create a second automation service or bypass suppression rules.
