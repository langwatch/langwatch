# Eventing has a sealed production-server adapter surface

**Date:** 2026-08-28

**Status:** Accepted

**Supersedes:** the persistence-adapter placement in
[the Eventing framework boundary](./20260820-eventing-framework-boundary.md).

## Decision

`@langwatch/eventing/server` is the only Eventing server adapter surface. It
exports the private Prisma process store, the ClickHouse event repository and
store, retention configuration, and one production runtime factory.

The factory accepts an already-created Prisma client, a tenant-aware ClickHouse
resolver, semantic retention configuration, and the complete Group Queue
dependency object. It never reads the environment, creates a global Prisma
client, or resolves a ClickHouse tenant itself. `@langwatch/clickhouse-client`
continues to own managed tenant-aware resolution.

Group Queue remains the owner of staged envelopes, their header, large-payload
offload, cleanup, size limits, delivery retries, and redelivery semantics. The
Eventing factory forwards its dependency object unchanged.

## Migration state

The platform adapters remain compatibility implementations until every caller
is rewired. The 2026-08-28 inventory found these non-Topic production callers:

- `platform/app/src/server/app-layer/presets.ts` (central runtime, replay,
  retention, and process-store composition);
- `platform/app/src/app/api/gateway-spend/[[...route]]/app.ts`;
- `platform/app/src/app/api/webhooks/[[...route]]/app.ts`; and
- `platform/app/src/server/api/routers/webhookEndpoints.ts`.

The same inventory found these test and helper deletion dependencies, which
must move with the adapter implementation:

- `platform/app/src/runtime/app/__tests__/trace-processing/core/recordSpanCommand.dedup.integration.test.ts`
  and `platform/app/src/runtime/app/__tests__/trace-processing/subscribers/tests/loopPrevention.integration.test.ts`;
- `platform/app/src/server/app-layer/evaluations/__tests__/evaluation-payload-offload.integration.test.ts`,
  `platform/app/src/server/app-layer/ops/__tests__/integration/process-ops.integration.test.ts`,
  and `platform/app/src/server/clickhouse/__tests__/privateClickhouseDataIsolation.integration.test.ts`;
- `platform/app/src/server/event-sourcing/__tests__/integration/eventLogDurability.integration.test.ts`,
  `platform/app/src/server/event-sourcing/__tests__/integration/testHelpers.ts`,
  and `platform/app/src/server/event-sourcing/__tests__/integration/topic-clustering-lifecycle.integration.test.ts`;
- `platform/app/src/server/event-sourcing/adapters/clickhouse/__tests__/eventRepositoryClickHouse.test.ts`,
  `eventStoreClickHouse.countEventsBefore.unit.test.ts`,
  `eventStoreClickHouse.emptyAggregateGuard.unit.test.ts`,
  `eventStoreClickHouse.refoldPartitionPruning.unit.test.ts`, and
  `eventStoreClickHouse.retentionStamping.unit.test.ts`;
- `platform/app/src/server/event-sourcing/adapters/postgres/__tests__/outboxBacklogDrain.integration.test.ts`
  and `prismaProcessStore.integration.test.ts`; and
- `platform/app/src/server/event-sourcing/pipelines/__tests__/metricsSync.convergence.integration.test.ts`,
  `platform/app/src/server/event-sourcing/pipelines/langy-conversation-processing/process-manager/__tests__/langyProcessPipeline.prisma.integration.test.ts`,
  and `platform/app/src/server/nlpgo/__tests__/traceparent-roundtrip.integration.test.ts`.

Topic is not sufficient evidence for deletion. API and Secret transport work
are outside this migration.

## Consequences

Process roots may import `@langwatch/eventing/server`; feature contracts and
ordinary callers continue to import only `@langwatch/eventing`. Generated
Prisma remains private to the server subpath and never crosses its adapter
return types.
