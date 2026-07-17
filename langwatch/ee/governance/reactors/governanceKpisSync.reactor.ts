// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@ee/governance/services/governanceAttributeKeys";
import {
  type GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { createLogger } from "@langwatch/observability";
import type { TraceSummarySubscriber } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedSubscriber";
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
export const GOVERNANCE_KPIS_SYNC_DEBOUNCE_TTL_MS = 5 * 60_000;

const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_INGESTION_SOURCE_TYPE = GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE;
const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

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
): TraceSummarySubscriber {
  return {
    name: "governanceKpisSync",
    spec: {
      fold: "traceSummary",
      ttl: GOVERNANCE_KPIS_SYNC_DEBOUNCE_TTL_MS,
      handler: async (_event, context) => {
        const { tenantId, state: foldState } = context;

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
          captureException(toError(error));
        }
      },
    },
  };
}
