import type { TraceListRepository } from "@langwatch/trace-contract";

import type { TraceClickHouse } from "./clickhouse/clickhouse.trace-member-client.repository.ts";
import type { LogRecordStorageRepository } from "./log-record-storage.repository.ts";
import type { SessionGroupsRepository } from "./session-groups.repository.ts";
import type { SpanStorageRepository } from "./span-storage.repository.ts";
import type { TraceAnalyticsFoldCacheRepository } from "./trace-analytics-fold-cache.repository.ts";
import type { TraceAnalyticsProjectionRepository } from "./trace-analytics-projection.repository.ts";
import type { TraceAnalyticsRollupRepository } from "./trace-analytics-rollup.repository.ts";
import type { TraceAttributeSpendRepository } from "./trace-attribute-spend.repository.ts";
import type { TraceClusteringSampleRepository } from "./trace-clustering-sample.repository.ts";
import type { TraceDerivationSpanReaderRepository } from "./trace-derivation-span-reader.repository.ts";
import type { TraceEditOverlayRepository } from "./trace-edit-overlay.repository.ts";
import type { TraceExistenceRepository } from "./trace-existence.repository.ts";
import type { TraceExportSlotRepository } from "./trace-export-slot.repository.ts";
import type { TraceModelSpendRepository } from "./trace-model-spend.repository.ts";
import type { TracePayloadReaderRepository } from "./trace-payload-reader.repository.ts";
import type { TraceRateLimitRepository } from "./trace-rate-limit.repository.ts";
import type { TraceSpanDedupRepository } from "./trace-span-dedup.repository.ts";
import type { TraceSummaryFoldCacheRepository } from "./trace-summary-fold-cache.repository.ts";
import type { TraceSummaryProjectionRepository } from "./trace-summary-projection.repository.ts";
import type { TraceSummaryRepository } from "./trace-summary.repository.ts";
import type { TraceUsageCountRepository } from "./trace-usage-count.repository.ts";

/**
 * The rows the trace module owns, chosen once at boot. One tier spans two
 * coexisting stores: Postgres holds the reviewer correction, ClickHouse the
 * three fold projections — a second required input, not an alternative.
 */
export interface TraceRepositories {
  readonly editOverlay: TraceEditOverlayRepository;
  readonly summaryProjection: TraceSummaryProjectionRepository;
  readonly analyticsProjection: TraceAnalyticsProjectionRepository;
  readonly analyticsRollup: TraceAnalyticsRollupRepository;
  /** The two folds' warm state; without it a fold reads back a lossy row mid-trace. */
  readonly summaryFoldCache: TraceSummaryFoldCacheRepository;
  readonly analyticsFoldCache: TraceAnalyticsFoldCacheRepository;
  readonly spanStorage: SpanStorageRepository;
  readonly existence: TraceExistenceRepository;
  readonly derivationSpans: TraceDerivationSpanReaderRepository;
  readonly summary: TraceSummaryRepository;
  readonly logRecords: LogRecordStorageRepository;
  readonly list: TraceListRepository;
  readonly sessionGroups: SessionGroupsRepository;
  /** Claim-check reads for fields the fold offloaded out of the summary. */
  readonly eventPayloads: TracePayloadReaderRepository;
  readonly clusteringSample: TraceClusteringSampleRepository;
  readonly usageCount: TraceUsageCountRepository;
  readonly modelSpend: TraceModelSpendRepository;
  readonly attributeSpend: TraceAttributeSpendRepository;
  /** The ingestion doors' duplicate claim, so an SDK's retry is not a second span. */
  readonly spanDedup: TraceSpanDedupRepository;
  /** The export door's in-flight slots. */
  readonly exportSlots: TraceExportSlotRepository;
  /** The export door's and the anonymous share read's rate windows. */
  readonly rateLimits: TraceRateLimitRepository;
  /** A raw tenant client, for the reads not yet behind a named repository. */
  readonly clickhouseClients: TraceClickHouse;
}
