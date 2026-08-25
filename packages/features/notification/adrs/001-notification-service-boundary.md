# ADR-001: One Notification service boundary

**Status:** Accepted

## Context

The `Notification` table is currently accessed by billing usage-limit policy,
while an unrelated legacy copy remains under `platform/app/src/server/notifications`.
Delivery is split across email, Slack, and HubSpot integrations. Treating a
provider or a billing policy as the Notification feature would make the
feature depend on infrastructure and on unrelated usage/organization rules.

## Decision

Notification owns the durable record: its portable schema, repository
capability, and one abstract `NotificationService`. The server implementation
uses a private Prisma repository and validates mapped rows with the contract
schema. The application composes one concrete instance.

Billing and other product features decide when to create a notification and
may collaborate with the canonical service through its contract. Mail, Slack,
HubSpot, queues, and templates remain injected infrastructure or owning-feature
delivery capabilities. Notification has no web package until a real inbox or
preference lifecycle exists.

## Consequences

The old unreferenced core notification implementation is removed. Enterprise
Billing now consumes `@langwatch/notification-contract` for its durable record
queries and composes the canonical PostgreSQL-backed service through
`@langwatch/notification-server`; it does not copy the repository or construct
it per request. The contract exposes only operations with real callers; it does
not keep the old repository's unused identifier lookup.
