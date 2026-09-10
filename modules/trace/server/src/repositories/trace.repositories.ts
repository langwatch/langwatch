import type { TraceAnalyticsProjectionPort } from "../ports/trace-analytics-projection.port.ts";
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
}
