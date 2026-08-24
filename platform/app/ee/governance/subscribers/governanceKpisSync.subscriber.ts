// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:trace-processing:governance-kpis-sync");

/**
 * Dedup window for the same trace's subscriber firings. Within this
 * window, replays for the same (tenant, trace) are suppressed by the
 * queue's dedup contract. Outside the window, structural idempotency
 * comes from the ReplacingMergeTree(LastEventOccurredAt) ORDER BY
 * (TenantId, SourceId, HourBucket, TraceId) — replays collapse to the
 * latest version of the same row.
 *
 * KPI rows are hour-bucketed and read only by a periodic evaluator, so holding
 * a trace's contributions for half a minute costs the consumer nothing while
 * collapsing a whole trace's spans into one write.
 */
export const GOVERNANCE_KPIS_SYNC_WINDOW_MS = 30_000;

const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_INGESTION_SOURCE_TYPE = GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE;

export interface GovernanceKpisSyncSubscriberDeps {
  governanceKpisRepository: GovernanceKpisClickHouseRepository;
}

/**
 * Pre-enqueue relevance guard: the origin check is a
 * pure read of the committed fold state, so deciding at `when` is equivalent
 * to the early-return in the handler — except a non-governance trace never
 * pays a serialize + queue round-trip for a job that would immediately no-op.
 * Every trace in a project fans this subscriber out, and governance traffic
 * is a small slice of it. Kept in the handler too: the queue is not the only
 * caller (inline mode), a fail-open `when` may dispatch anyway, and an
 * already-queued job may predate this gate.
 */
export function isGovernanceKpiTrace(
  _event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
): boolean {
  return isGovernanceOriginTrace(context.state.attributes);
}

/**
 * Folds completed governance-origin traces into per-(SourceId,
 * HourBucket) rollup rows in ClickHouse. Each trace contributes ONE
 * row keyed by (TenantId, SourceId, HourBucket, TraceId). Reads
 * aggregate via `sum(SpendUsd)` / `count(DISTINCT TraceId)` over the
 * (SourceId, HourBucket) group.
 *
 * Registered on the trace_processing pipeline downstream of the
 * traceSummary fold. Reads the governance origin attributes off the
 * fold state (hoisted from spans into trace_summaries.Attributes by
 * the SPAN_ATTR_MAPPINGS edit shipped in step 3a / fd118131c). Traces
 * without `langwatch.origin.kind = "ingestion_source"` are not
 * governance traffic and are declined before a job is enqueued.
 *
 * NOTE: the handler swallows repository failures by design (see its catch,
 * and the test pinning it). The throttle window makes that cheaper to get
 * wrong: a burst leaves ONE job, so a failed write is retried by the NEXT
 * window rather than by the next span, and a failure in a trace's final
 * window is not retried at all. Whether these should rethrow is an open
 * question. Level-triggered: the row carries the fold's running totals, so
 * the LAST event of a trace must always land — shouldSurviveDispatch stays
 * off on the throttle.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 */
export function createGovernanceKpisSyncHandler(
  deps: GovernanceKpisSyncSubscriberDeps,
): (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, state: foldState } = context;

    const contribution = resolveContribution({ tenantId, foldState });
    if (!contribution) return;

    try {
      await deps.governanceKpisRepository.insertContribution(contribution);
    } catch (error) {
      logger.error(
        {
          tenantId,
          sourceId: contribution.sourceId,
          traceId: foldState.traceId,
          error,
        },
        "failed to fold governance trace into governance_kpis",
      );
      captureException(toError(error));
    }
  };
}

/** The guards plus the row: undefined means "not a foldable governance trace". */
function resolveContribution({
  tenantId,
  foldState,
}: {
  tenantId: string;
  foldState: TraceSummaryData;
}): GovernanceKpiContribution | undefined {
  if (!isGovernanceOriginTrace(foldState.attributes)) return undefined;

  const sourceId = foldState.attributes[ATTR_INGESTION_SOURCE_ID];
  if (!sourceId) {
    logger.warn(
      {
        tenantId,
        traceId: foldState.traceId,
      },
      "governance trace missing langwatch.ingestion_source.id — skipping fold",
    );
    return undefined;
  }

  const occurredAtMs = foldState.occurredAt;
  if (!occurredAtMs || occurredAtMs <= 0) return undefined;

  return {
    tenantId,
    sourceId,
    sourceType: foldState.attributes[ATTR_INGESTION_SOURCE_TYPE] ?? "unknown",
    hourBucket: new Date(
      Math.floor(occurredAtMs / (60 * 60 * 1000)) * 60 * 60 * 1000,
    ),
    traceId: foldState.traceId,
    spendUsd: foldState.totalCost ?? 0,
    promptTokens: foldState.totalPromptTokenCount ?? 0,
    completionTokens: foldState.totalCompletionTokenCount ?? 0,
    lastEventOccurredAt: new Date(occurredAtMs),
  };
}
