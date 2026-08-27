# ADR-001: Topic service boundary

**Status:** accepted

**Behavioural contract:** [Topic read surface](../specs/topic-read-surface.feature)

## Context

Topic clustering behaviour was spread across the app's event-sourcing
pipelines, app-layer services, and the feature packages, with callers able to
reach subordinate implementations directly.

## Decision

The singular `topic` feature owns the projected topic model, the
topic-clustering eventing pipeline, and the read surface for clustering
status and history. It exposes one portable `TopicService`. The contract owns
topic DTOs, clustering status, bounded run history, and the portable
clustering event/command taxonomy: type strings, schema and projection
versions, the run-mode/skip-reason/outcome enums, event data schemas, and
`TOPIC_CLUSTERING_STALE_RUN_MS` — the single stale-run definition shared by
the process (which abandons runs) and the service (which stops reporting them
on the same clock). The contract stays free of eventing and server
dependencies.

## Public surfaces and transports

tRPC names, response shapes, and the settings-page read model do not change.
Event names, versions, projection versions, idempotency keys, and outbox
tuning (maxAttempts 3, lease 20min, concurrency/batchSize 3) are unchanged by
the move. `app.topics` remains the single application-graph capability.

## Dependencies

The concrete service receives its private repository and the schedule port.
The pipeline adapter receives its projection stores and dispatch dependencies
from composition. The intent executor's failure classification and page
metrics stay app-owned (the classifier lives with the clustering execution,
the counters in the app metrics module) and enter as injected ports.

## Persistence

The Postgres Topic, run-status, and run-history rows are written only by the
pipeline's fold projections; the private repository reads them. Malformed
history JSON reads as an empty rebuildable history. Topic list order remains
the database's order.

## Runtime and registration

`server` owns the event envelopes
(`adapters/eventing.topic.adapter.ts`), the five commands and the run intent
executor (`intents/topic-clustering.intent.ts`), the three fold projections
(`projections/`), the `topicClustering` process manager
(`processes/topic-clustering.process.ts`), and the pipeline factory
(`adapters/eventing.topic-clustering.adapter.ts`). It also owns the clustering
runner, boot migration, and private Prisma projection adapters. Registration
remains app composition: `pipelineRegistry.ts` supplies the package pipeline
with its private stores, the app-owned ClickHouse/model-provider/langevals
ports, metrics, and late-bound outcome commands. The full-stack lifecycle
integration test stays app-side because it composes the application event-log
and Prisma infrastructure.

## Environment and configuration

Configuration and technology adapters enter at process composition. Contract
and server packages do not read app environment modules.

## Errors

Contract and projection schemas parse at every boundary; malformed persisted
read models degrade to empty rebuildable state rather than poisoning folds.
Clustering failures classify through the injected classifier and surface to
the read model as stable codes, never raw provider text.

## Contracts and validation

Portable contract schemas define transport and event-payload values.
Transports and commands parse those values; the event envelopes close over
them in the server.

## Consequences

There is one discoverable service and one pipeline definition. Server
persistence stays private, and the eventing topology is replayable from the
package. No second Topic or Topic Clustering service exists.
