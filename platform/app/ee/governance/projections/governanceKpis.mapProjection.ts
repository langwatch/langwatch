// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_kpis` as a real projection (ADR-075 Class C, retired; ground
 * now ADR-098).
 *
 * THE PROBLEM ADR-075 NAMES (ADR-075 retired; ground now ADR-098)
 * -------------------------
 * ADR-075 calls this "the one that needs work: it is an incrementing
 * aggregate per (org, source, hour_bucket), so re-deriving it means
 * recomputing the bucket rather than re-applying a delta."
 *
 * The DDL says something slightly different, and the difference matters.
 * `governance_kpis` is NOT a stored counter: migration 00031 created it as
 * `ReplacingMergeTree(LastEventOccurredAt)` over per-CONTRIBUTION rows,
 * `ORDER BY (TenantId, SourceId, HourBucket, TraceId)`, and the readers
 * aggregate with `sum(SpendUsd)`. So the bucket is a read-time aggregate
 * over a SET of keyed rows, and the real question is not "how do we
 * recompute a counter" but "is that set idempotent under re-derivation".
 *
 * It was not, for two reasons:
 *
 *  1. The row was keyed per TRACE but written with the trace's RUNNING
 *     totals, once per reactor firing. Every firing produced a different
 *     `SpendUsd` under the same key.
 *  2. The version column was `LastEventOccurredAt = TraceSummaryData.occurredAt`,
 *     which is the trace's EARLIEST span start (`SpanTimingService` takes a
 *     `Math.min`). It is constant across firings, so the competing rows
 *     TIE on version and ClickHouse's choice of survivor is arbitrary —
 *     and it can go DOWN when a span with an earlier start arrives late,
 *     so a more complete row can lose to a less complete one. A replay
 *     writing the final totals would tie with the live partials in exactly
 *     the same way, which is why "rebuild to correct drift" could not work
 *     even in principle.
 *
 * THE SHAPE CHOSEN
 * ----------------
 * Keep ReplacingMergeTree; move the key to the EVENT.
 *
 * Each governance span contributes ONE row carrying that span's own cost
 * and tokens, keyed by `(TenantId, SourceId, HourBucket, TraceId, EventId)`
 * where `EventId` is the span id (migration 00063 adds the column and
 * extends the sorting key). Re-deriving a span produces a byte-identical
 * row under the same key, so a rebuild is a set-union of elements the set
 * already contains — idempotent by construction, whatever order rebuild
 * and live writes interleave in. The version column becomes the span
 * event's own `occurredAt`: identical on re-derivation (so ties are
 * content-identical and harmless) and strictly later on a genuine
 * re-report (so the newer report wins).
 *
 * WHY NOT SummingMergeTree / AggregatingMergeTree
 * -----------------------------------------------
 * Both collapse rows by summing them, so they cannot tell a re-derivation
 * from a second event: a rebuild would ADD the window again. That is
 * precisely the `suite_runs` failure ADR-072 (retired; ground now ADR-103)
 * removed, and migration
 * 00031's own header already rejected SummingMergeTree for it. An
 * additive engine is only safe behind exactly-once delivery, which the
 * event log deliberately does not offer. Making the ROW SET idempotent
 * and summing at read time keeps the aggregate correct without needing
 * exactly-once anywhere.
 *
 * WHY NOT A FOLD THAT RECOMPUTES THE BUCKET
 * -----------------------------------------
 * A fold is keyed by aggregateId (= traceId here), so two traces feeding
 * the same (source, hour) bucket race on load-mutate-store — migration
 * 00031's header rejected that too. A bucket-keyed fold would fix the race
 * but serialise every governance trace in an hour behind one fold key, and
 * it would still need a read of the whole bucket to recompute it. The
 * per-event contribution row gets the same convergence with no state, no
 * read, and no contention.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_kpis"
 * ADR:  dev/docs/adr/098-event-sourcing-core.md (successor to the retired
 *       ADR-075)
 */

import type { GovernanceKpiContribution } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { spanCostService } from "@ee/governance/services/spanDerivation.composition";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/spans";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "~/server/event-sourcing.old/projections/abstractMapProjection";
import type { AppendStore } from "~/server/event-sourcing.old/projections/mapProjection.types";
import {
  normalizeGovernanceSpanOrNull,
  readGovernanceSpanFacts,
} from "./governanceSpanFacts";

const spanEvents = [spanReceivedEventSchema] as const;

const HOUR_MS = 60 * 60 * 1000;

/** Floor a unix-ms timestamp to the hour boundary (toStartOfHour equivalent). */
export function toStartOfHour(unixMs: number): Date {
  return new Date(Math.floor(unixMs / HOUR_MS) * HOUR_MS);
}

/**
 * Derives one governance KPI contribution row for a span, or null when
 * the span is not governance traffic.
 *
 * PURE and TOTAL over its inputs, for the same reason the OCSF derivation
 * is: a rebuild has to reproduce the live row exactly, not approximately.
 *
 * Cost and tokens come from `SpanCostService` — the SAME calls the
 * trace-summary and trace-analytics folds make, including the
 * `isTokenAccumulationSkipped` gate that zeroes a span echoing another
 * span's usage. Re-deriving those numbers from raw attribute reads is how
 * the governance spend figure silently drifts away from the trace totals
 * the same customer sees on /traces.
 */
export function deriveGovernanceKpiContribution({
  tenantId,
  span,
  occurredAtMs,
}: {
  tenantId: string;
  span: NormalizedSpan;
  /**
   * The span EVENT's `occurredAt` from the log — the ReplacingMergeTree
   * version. Immutable in the event log, so a rebuild reproduces it, and
   * strictly later on a genuine re-report of the same span id. Falls back
   * to the span's own start when the envelope carries no usable value, so
   * the derivation stays total rather than writing an Invalid Date into
   * the version column.
   */
  occurredAtMs: number;
}): GovernanceKpiContribution | null {
  const facts = readGovernanceSpanFacts(span);
  if (!facts) return null;

  const version =
    Number.isFinite(occurredAtMs) && occurredAtMs > 0
      ? occurredAtMs
      : facts.eventTimeMs;

  const skipTokenAccumulation =
    spanCostService.isTokenAccumulationSkipped(span);
  const tokens = skipTokenAccumulation
    ? { promptTokens: 0, completionTokens: 0, cost: 0 }
    : spanCostService.extractTokenMetrics(span);

  return {
    tenantId,
    sourceId: facts.sourceId,
    sourceType: facts.sourceType,
    hourBucket: toStartOfHour(facts.eventTimeMs),
    traceId: facts.traceId,
    eventId: facts.eventId,
    spendUsd: tokens.cost,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    lastEventOccurredAt: new Date(version),
  };
}

/**
 * Map projection that derives one `governance_kpis` contribution row per
 * governance span.
 *
 * Non-governance spans are rejected by a raw-wire attribute scan before
 * normalisation, so this projection costs an array scan on the hot path.
 */
export class GovernanceKpisMapProjection
  extends AbstractMapProjection<GovernanceKpiContribution, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, GovernanceKpiContribution>
{
  readonly name = "governanceKpis";
  readonly store: AppendStore<GovernanceKpiContribution>;
  protected readonly events = spanEvents;

  override options = {
    // Per-span parallelism — contributions are independent rows, and the
    // bucket they roll into is computed at read time, not accumulated here.
    groupKeyFn: (event: { id: string }) => `governance-kpis:${event.id}`,
  };

  constructor(deps: { store: AppendStore<GovernanceKpiContribution> }) {
    super();
    this.store = deps.store;
  }

  mapTraceSpanReceived(
    event: SpanReceivedEvent,
  ): GovernanceKpiContribution | null {
    const span = normalizeGovernanceSpanOrNull(event);
    if (!span) return null;

    return deriveGovernanceKpiContribution({
      tenantId: event.tenantId,
      span,
      occurredAtMs: event.occurredAt,
    });
  }
}
