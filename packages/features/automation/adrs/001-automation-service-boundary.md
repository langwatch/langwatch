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

Provider schemas, sentinels, action vocabulary, graph-alert/report policy, and
reusable templating live in the automation contract. Browser-safe authoring,
provider forms, Monaco behaviour, and controlled overview presentation live in
`automation-web`;
threshold/series policy lives in the contract and delivery persistence policy
lives in `automation-server`. The server package also owns persist-cap runaway
containment as a claim-gated policy over injected pause, counting, notification,
and telemetry ports. These are package slices, not second services.

Template validation and test-fire rendering are operations on the same
`AutomationService`. The app supplies one named delivery adapter for mail,
Slack, and generic webhooks; transports do not receive a callback bag.

Graph-trigger evaluation, heartbeat candidate selection, and runaway containment
are operations on the same concrete `AutomationService`. Construction receives
canonical Analytics/Project services plus explicit notifier, ClickHouse,
provider, claim, and telemetry ports; Eventing supplies only trigger id/reason
and heartbeat time. The server package also owns the shared per-trigger hourly
and per-project daily email-cap policy, with its Redis connection passed
explicitly and a documented per-worker in-memory fallback. `AutomationEmailCapService`
is separate because its lifetime follows the process-owned Redis connection and
fallback counters, rather than the persisted trigger service. It is composed
once and shared by both dispatch paths; callers cannot select its store.
Graph incident persistence is a private Automation repository.

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

`PostgresAutomationAdapter` exposes explicit static construction for the process
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

Runaway containment preserves the existing UTC-day cap, 60-second evaluation
and pause claims, 90%/100-trace misconfiguration threshold, suppression-aware
recipient selection, and failure containment. The app supplies Redis,
ClickHouse, Prisma, mail, and metrics capabilities without moving those
process-specific dependencies into the feature. Email delivery caps preserve
their idempotency keys across outbox retries, so a retry re-reads a cap instead
of consuming another slot.

The graph evaluator preserves row-ceiling isolation, threshold/no-data
semantics, source-aware heartbeat batching, open-incident claiming,
provider retry/terminal classification, delivery gating, and last-run updates.
The app composition edge retains provider implementations; graph source and
incident discovery remain private Automation repository operations. It does not
construct a second graph service or repository.

## Consequences

Trigger, fire-history, report-schedule, and email-suppression lifecycles share
one process-owned service capability and one ownership root. Compatibility
transports keep their existing URLs while mapping their inputs to that
capability. Repository and scheduler details remain private, so callers cannot
silently create a second automation service or bypass suppression rules.
