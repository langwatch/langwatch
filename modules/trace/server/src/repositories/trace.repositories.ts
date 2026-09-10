import type { TraceAnalyticsProjectionPort } from "../ports/trace-analytics-projection.port.ts";
import type { TraceDerivationSpanReaderPort } from "../ports/trace-derivation-span-reader.port.ts";
import type { TraceExistencePort } from "../ports/trace-existence.port.ts";
import type { LogRecordStorageRepository } from "./log-record-storage.repository.ts";
import type { SpanStorageRepository } from "./span-storage.repository.ts";
import type { TraceSummaryRepository } from "./trace-summary.repository.ts";
import type { TraceAnalyticsRollupPort } from "../ports/trace-analytics-rollup.port.ts";
import type { TraceSummaryProjectionPort } from "../ports/trace-summary-projection.port.ts";
import type { TraceEditOverlayRepository } from "./trace-edit-overlay.repository.ts";

/**
 * The rows the trace module owns, chosen once at boot. One tier spans two
 * stores that coexist rather than compete: Postgres holds the reviewer
 * correction, ClickHouse holds the three projections the fold commits
 * through. ClickHouse is a second required input to the same tier, not an
 * alternative to it.
 */
export interface TraceRepositories {
  readonly editOverlay: TraceEditOverlayRepository;
  readonly summaryProjection: TraceSummaryProjectionPort;
  readonly analyticsProjection: TraceAnalyticsProjectionPort;
  readonly analyticsRollup: TraceAnalyticsRollupPort;
  readonly spanStorage: SpanStorageRepository;
  readonly existence: TraceExistencePort;
  readonly derivationSpans: TraceDerivationSpanReaderPort;
  readonly summary: TraceSummaryRepository;
  readonly logRecords: LogRecordStorageRepository;
}
