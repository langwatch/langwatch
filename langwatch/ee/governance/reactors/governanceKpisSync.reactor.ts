// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "@ee/governance/services/governanceAttributeKeys";
import type {
  GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type {
  ReactorContext,
  ReactorDefinition,
} from "~/server/event-sourcing/reactors/reactor.types";
import { throttledPerWindow } from "~/server/event-sourcing/reactors/throttleWindow";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger(
  "langwatch:trace-processing:governance-kpis-sync-reactor",
);

/**
 * Dedup window for the same trace's reactor firings. Within this
 * window, replays for the same (tenant, trace) are suppressed by the
 * BullMQ job-id contract. Outside the window, structural idempotency
 * comes from the ReplacingMergeTree(LastEventOccurredAt) ORDER BY
 * (TenantId, SourceId, HourBucket, TraceId) — replays collapse to the
 * latest version of the same row.
 */
/**
 * KPI rows are hour-bucketed and read only by a periodic evaluator, so holding
 * a trace's contributions for half a minute costs the consumer nothing while
 * collapsing a whole trace's spans into one write.
 */
export const GOVERNANCE_KPIS_SYNC_WINDOW_MS = 30_000;

const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_INGESTION_SOURCE_TYPE = GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE;

export interface GovernanceKpisSyncReactorDeps {
  governanceKpisRepository: GovernanceKpisClickHouseRepository;
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
 * Spec: specs/ai-gateway/governance/folds.feature
 */
export function createGovernanceKpisSyncReactor(
  deps: GovernanceKpisSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "governanceKpisSync",
    // Pre-enqueue (ADR-026). The origin check is a pure read of the same
    // payload the handler receives, so deciding here is equivalent to the
    // early-return below — except a non-governance trace never pays a
    // serialize + queue round-trip for a job that would immediately no-op.
    // Every trace in a project fans this reactor out, and governance traffic
    // is a small slice of it. Kept in `handle` too: the queue is not the only
    // caller (inline mode), a fail-open `shouldReact` may dispatch anyway,
    // and an already-queued job may predate this gate.
    shouldReact: (_event, context) =>
      isGovernanceOriginTrace(context.foldState.attributes),
    options: {
      // Level-triggered: the row carries the fold's running totals, so the
      // LAST event of a trace must always land. surviveDispatch stays off.
      ...throttledPerWindow({
        makeJobId: (payload) =>
          `governance-kpis-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
        windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
      }),
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      if (!isGovernanceOriginTrace(foldState.attributes)) {
        return;
      }

      const sourceId = foldState.attributes[ATTR_INGESTION_SOURCE_ID];
      const sourceType =
        foldState.attributes[ATTR_INGESTION_SOURCE_TYPE] ?? "unknown";

      if (!sourceId) {
        logger.warn(
          {
            tenantId,
            traceId: foldState.traceId,
          },
          "governance trace missing langwatch.ingestion_source.id — skipping fold",
        );
        return;
      }

      try {
        const occurredAtMs = foldState.occurredAt;
        if (!occurredAtMs || occurredAtMs <= 0) {
          return;
        }
        const hourBucket = new Date(
          Math.floor(occurredAtMs / (60 * 60 * 1000)) * 60 * 60 * 1000,
        );

        const contribution: GovernanceKpiContribution = {
          tenantId,
          sourceId,
          sourceType,
          hourBucket,
          traceId: foldState.traceId,
          spendUsd: foldState.totalCost ?? 0,
          promptTokens: foldState.totalPromptTokenCount ?? 0,
          completionTokens: foldState.totalCompletionTokenCount ?? 0,
          lastEventOccurredAt: new Date(occurredAtMs),
        };

        await deps.governanceKpisRepository.insertContribution(contribution);
      } catch (error) {
        logger.error(
          {
            tenantId,
            sourceId,
            traceId: foldState.traceId,
            error,
          },
          "failed to fold governance trace into governance_kpis",
        );
        captureException(toError(error));
      }
    },
  };
}
