# ADR-001: One Notification service boundary

**Status:** Accepted

**Behavioural contract:** [Notification service](../specs/notification-service.feature)

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

## Public surfaces and transports

The contract publishes the notification record schemas and one abstract
`NotificationService` with two operations: create a record, and list an
organization's recent records. The server package publishes only its composition
adapter. Notification mounts no route and has no browser package, so every
surface it has is a service call from a composing feature.

## Dependencies

The contract depends only on Zod. The server depends on that contract and on the
generated Prisma client. Notification depends on no other feature, and no
delivery provider is a dependency: mail, Slack and HubSpot stay with whoever
decides to send.

## Persistence

One private Prisma repository owns the `Notification` table. It filters recent
reads by organization and cut-off timestamp, orders them by send time, and
validates every row it maps.

## Runtime and registration

The composing feature builds the instance; there is no global registration and
no place on the shared application context. Enterprise Billing builds one inside
its own persistence adapter and uses it for usage-limit records, and a future
consumer builds its own the same way. The feature owns no worker job, subscriber or
event pipeline. The application context property named `notifications` is a
separate, application-owned delivery capability and is not this service.

## Environment and configuration

Notification packages read no environment value. The database client is the only
constructor argument.

## Errors

Notification defines no errors of its own. A rejected input or an unreadable row
fails schema validation, and a persistence failure surfaces as itself, so a
composing feature keeps whatever failure handling its own operation needs.

## Contracts and validation

Zod 4 schemas define the stored record, the create command and the recent-record
query. All three are strict, and the repository parses both the input it accepts
and the row it returns, so generated Prisma records never leave the server
package.

## Consequences

The old unreferenced core notification implementation is removed. Enterprise
Billing now consumes `@langwatch/notification-contract` for its durable record
queries and composes the canonical PostgreSQL-backed service through
`@langwatch/notification-server`; it does not copy the repository or construct
it per request. The contract exposes only operations with real callers; it does
not keep the old repository's unused identifier lookup.
