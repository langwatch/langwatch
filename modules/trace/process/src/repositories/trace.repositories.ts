import type { TraceListRepository } from "@langwatch/trace-contract";

import type { LogRecordStorageRepository } from "./log-record-storage.repository.ts";
import type { TraceAnalyticsProjectionRepository } from "./projection/trace-analytics-projection.repository.ts";
import type { TraceAnalyticsRollupRepository } from "./projection/trace-analytics-rollup.repository.ts";
import type { TraceSummaryProjectionRepository } from "./projection/trace-summary-projection.repository.ts";
import type { SessionGroupsRepository } from "./session-groups.repository.ts";
import type { SpanStorageRepository } from "./span-storage.repository.ts";
import type { TraceAttributeSpendRepository } from "./trace-attribute-spend.repository.ts";
import type { TraceClusteringSampleRepository } from "./trace-clustering-sample.repository.ts";
import type { TraceDerivationSpanReaderRepository } from "./trace-derivation-span-reader.repository.ts";
import type { TraceEditOverlayRepository } from "./trace-edit-overlay.repository.ts";
import type { TraceExistenceRepository } from "./trace-existence.repository.ts";
import type { TraceModelSpendRepository } from "./trace-model-spend.repository.ts";
import type { TracePayloadReaderRepository } from "./trace-payload-reader.repository.ts";
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
}
