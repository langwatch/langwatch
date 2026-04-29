import {
  GovernanceKpisClickHouseRepository,
  type GovernanceKpiContribution,
} from "~/server/governance/governanceKpis.clickhouse.repository";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

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
export const GOVERNANCE_KPIS_SYNC_DEBOUNCE_TTL_MS = 5 * 60_000;

const ATTR_ORIGIN_KIND = "langwatch.origin.kind";
const ATTR_INGESTION_SOURCE_ID = "langwatch.ingestion_source.id";
const ATTR_INGESTION_SOURCE_TYPE = "langwatch.ingestion_source.source_type";
const ORIGIN_KIND_VALUE = "ingestion_source";

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
 * without `langwatch.origin.kind = "ingestion_source"` are skipped —
 * not governance traffic.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 */
export function createGovernanceKpisSyncReactor(
  deps: GovernanceKpisSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "governanceKpisSync",
    options: {
      makeJobId: (payload) =>
        `governance-kpis-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: GOVERNANCE_KPIS_SYNC_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      const originKind = foldState.attributes[ATTR_ORIGIN_KIND];
      if (originKind !== ORIGIN_KIND_VALUE) {
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
        captureException(error);
      }
    },
  };
}
