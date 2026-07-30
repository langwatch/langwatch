import {
  type AppendStore,
  createMapExecutor,
  type GroupKey,
  type Metrics,
  renderGroupKey,
} from "@langwatch/event-sourcing";

/**
 * The billable event types this meter reacts to, spanning the 4 pipelines
 * that produce billable usage: trace, evaluation, experiment-run and
 * simulation processing. ADR-102 §4 names this projection specifically as one
 * that "spans 4 event vocabularies", which is why it lives in its own
 * pipeline rather than any one of theirs.
 *
 * Copied here as literal type strings rather than imported from
 * `event-sourcing.old`'s per-pipeline `schemas/constants.ts` files: an event
 * type string is a persisted identifier (it lives in `event_log` forever),
 * not an implementation detail of whichever pipeline currently declares it,
 * and this pipeline must not take a dependency on a tree slated for
 * retirement. When each source pipeline is rewritten under ADR-105's
 * `defineAggregate`, it will derive the same strings from its own
 * declaration; nothing here needs to change when that happens.
 */
export const BILLABLE_EVENT_TYPES = [
  "lw.obs.trace.span_received",
  // `reported` is the only evaluation event production ever emits (via
  // reportEvaluation / ReportEvaluationCommand / ExecuteEvaluationCommand).
  // Its idempotencyKey is `${tenantId}:${evaluationId}:reported`, so retries
  // and replays collapse to exactly one billable unit per evaluation.
  "lw.evaluation.reported",
  "lw.experiment_run.started",
  "lw.experiment_run.evaluator_result",
  "lw.experiment_run.target_result",
  "lw.simulation_run.started",
  "lw.simulation_run.message_snapshot",
] as const;

export type BillableEventType = (typeof BILLABLE_EVENT_TYPES)[number];

/**
 * The minimal shape this projection needs from an event. Declared locally
 * rather than importing `event-sourcing.old`'s `Event` type: this pipeline
 * depends on a narrow port, not on the whole (deprecated) core event union.
 */
export interface BillableSourceEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  /** When the event was written (platform ingest time), in epoch ms. */
  readonly createdAt: number;
  /** Business-level dedup key, when the source pipeline supplies one. */
  readonly idempotencyKey?: string;
}

/** One row this projection produces per event, before organization resolution. */
export interface BillableEventMeterRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly deduplicationKey: string;
  readonly eventTimestamp: number;
}

/**
 * The deduplication key: the event's own business-level idempotency key when
 * it has one, otherwise the event id. This is the value `billable_events`'
 * `DeduplicationKey` column carries, and therefore the value ClickHouse hashes
 * into the sort key that makes a redelivery collapse (see
 * `billableEventsTable.ts`). Two calls with the same event (a retry, a
 * replay) must return the same key here for that guarantee to hold, which is
 * exactly what `idempotencyKey ?? id` gives: both are stable identities of
 * the same event, never regenerated per delivery.
 */
export function extractDeduplicationKey(event: BillableSourceEvent): string {
  return event.idempotencyKey ?? event.id;
}

/**
 * The map (ADR-098 §2): pure, no accumulator, independent per event. Two
 * deliveries of the same event produce the identical record, so batching is
 * free and redelivery is safe by construction — the actual double-billing
 * guard lives in the store's table (ReplacingMergeTree), not here.
 */
export function mapBillableEvent(event: BillableSourceEvent): BillableEventMeterRecord {
  return {
    eventId: event.id,
    eventType: event.type,
    deduplicationKey: extractDeduplicationKey(event),
    eventTimestamp: event.createdAt,
  };
}

/**
 * The dispatch-plane group key (ADR-100). `partition`, scoped to the event's
 * own project, rather than `event` (one lane per event) — unlike the two
 * analytics rollups ADR-100 found wrongly event-scoped against an
 * `AggregatingMergeTree` table, batching here is safe: this store is
 * append-shaped (`writeBatch`, no accumulator to interleave), so any number
 * of events sharing a lane may coalesce into one insert with no correctness
 * change, only a throughput one. Partitioned per project rather than per
 * organization because the event only carries its own project id; two
 * projects under one organization batching in separate lanes costs nothing,
 * since the store resolves the organization once per batch regardless of lane
 * width.
 *
 * ADR-106's mount descriptor for this projection is
 * `{ projection: "map", store: "replace", scope: "partition", collapse: "none" }`
 * — legal under decision 2's table (one of the 24 rows `LEGAL_MOUNT_SHAPES`
 * enumerates). It cannot be checked by `validateMount` here: that function and
 * the `Mount` type exist in `packages/event-sourcing/src/mount/` but are not
 * re-exported from the package's `index.ts` (its `exports` map has exactly
 * one entry point, and the package's own docblock is explicit that "a symbol
 * that exists in `src/` but is not re-exported here is unreachable from
 * outside the package"). Flagged rather than worked around with a deep
 * import that would not resolve through the declared `exports` map anyway.
 */
export function billableEventsMeterGroupKey(event: BillableSourceEvent): GroupKey {
  return {
    tenantId: event.tenantId,
    lane: { kind: "map", name: "billableEventsMeter" },
    scope: { kind: "partition", parts: [event.tenantId] },
  };
}

export function renderBillableEventsMeterGroupKey(event: BillableSourceEvent): string {
  return renderGroupKey(billableEventsMeterGroupKey(event));
}

/**
 * Builds the executor for this projection (ADR-098). `store` is expected to
 * be built from `billableEventsMeter.store.ts`'s `createBillableEventsMeterStore`,
 * which wraps `@langwatch/clickhouse`'s `createAppendStore` over
 * `billableEventsTable`.
 */
export function createBillableEventsMeterProjection(deps: {
  readonly store: AppendStore<BillableEventMeterRecord>;
  readonly metrics?: Metrics;
}) {
  return createMapExecutor({
    store: deps.store,
    map: mapBillableEvent,
    projectionName: "billableEventsMeter",
    metrics: deps.metrics,
  });
}
