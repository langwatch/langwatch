import type { TraceAnalyticsProjectionRepository } from "./projection/trace-analytics-projection.repository.ts";
import type { TraceDerivationSpanReaderRepository } from "./read/trace-derivation-span-reader.repository.ts";
import type { TraceExistenceRepository } from "./read/trace-existence.repository.ts";
import type { LogRecordStorageRepository } from "./log-record-storage.repository.ts";
import type { SpanStorageRepository } from "./span-storage.repository.ts";
import type { TraceSummaryRepository } from "./trace-summary.repository.ts";
import type { TraceAnalyticsRollupRepository } from "./projection/trace-analytics-rollup.repository.ts";
import type { TraceSummaryProjectionRepository } from "./projection/trace-summary-projection.repository.ts";
import type { TraceEditOverlayRepository } from "./trace-edit-overlay.repository.ts";
import type { SessionGroupsRepository } from "./session-groups.repository.ts";
import type { TraceListRepository } from "@langwatch/trace-contract";
import type { TracePayloadReaderRepository } from "./read/trace-payload-reader.repository.ts";

/**
 * The rows the trace module owns, chosen once at boot. One tier spans two
 * stores that coexist rather than compete: Postgres holds the reviewer
 * correction, ClickHouse holds the three projections the fold commits
 * through. ClickHouse is a second required input to the same tier, not an
 * alternative to it.
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
}
