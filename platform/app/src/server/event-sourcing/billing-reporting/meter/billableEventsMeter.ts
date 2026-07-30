import { z } from "zod";
import {
  type AppendStore,
  createMapExecutor,
  type GroupKey,
  type Metrics,
  renderGroupKey,
} from "@langwatch/event-sourcing";

/**
 * Which of the platform's events count as billable usage — a pricing policy
 * this pipeline owns, not a mirror of another pipeline's vocabulary, which is
 * why it is a constant here rather than injected at the mount.
 *
 * `lw.evaluation.reported` is the only evaluation event production emits; its
 * idempotency key is `${tenantId}:${evaluationId}:reported`, so retries and
 * replays collapse to one billable unit per evaluation.
 */
export const BILLABLE_EVENT_TYPES = [
  "lw.obs.trace.span_received",
  "lw.evaluation.reported",
  "lw.experiment_run.started",
  "lw.experiment_run.evaluator_result",
  "lw.experiment_run.target_result",
  "lw.simulation_run.started",
  "lw.simulation_run.message_snapshot",
] as const;

export type BillableEventType = (typeof BILLABLE_EVENT_TYPES)[number];

/** What this meter reads off an event. Narrower than the source pipelines'
 *  own event unions on purpose: nothing here reads a payload. */
export interface BillableSourceEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  /** Platform ingest time, epoch ms. */
  readonly createdAt: number;
  /** Business-level dedup key, when the source pipeline supplies one. */
  readonly idempotencyKey?: string;
}

/** One row this meter produces per event, before organization resolution. */
export const billableEventMeterRecordSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  deduplicationKey: z.string(),
  eventTimestamp: z.number(),
});
export type BillableEventMeterRecord = z.infer<
  typeof billableEventMeterRecordSchema
>;

/**
 * The value `billable_events.DeduplicationKey` carries, and therefore the
 * pre-image of the sort key that makes a redelivery collapse. Both branches
 * are stable identities of the same event, never regenerated per delivery, so
 * two deliveries always produce the same key.
 */
export function extractDeduplicationKey(event: BillableSourceEvent): string {
  return event.idempotencyKey ?? event.id;
}

/** Pure, no accumulator, independent per event: two deliveries of the same
 *  event produce the identical record. The double-billing guard is the
 *  table's ReplacingMergeTree identity, not this function. */
export function mapBillableEvent(
  event: BillableSourceEvent,
): BillableEventMeterRecord {
  return {
    eventId: event.id,
    eventType: event.type,
    deduplicationKey: extractDeduplicationKey(event),
    eventTimestamp: event.createdAt,
  };
}

/**
 * A `partition` lane scoped to the event's project, not one lane per event:
 * this store is append-shaped, so any number of events sharing a lane may
 * coalesce into one insert with no correctness change. Partitioned by project
 * rather than organization because the event only carries its project id, and
 * the store resolves the organization once per batch regardless of lane width.
 */
export function billableEventsMeterGroupKey(
  event: BillableSourceEvent,
): GroupKey {
  return {
    tenantId: event.tenantId,
    lane: { kind: "map", name: "billableEventsMeter" },
    scope: { kind: "partition", parts: [event.tenantId] },
  };
}

export function renderBillableEventsMeterGroupKey(
  event: BillableSourceEvent,
): string {
  return renderGroupKey(billableEventsMeterGroupKey(event));
}

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
