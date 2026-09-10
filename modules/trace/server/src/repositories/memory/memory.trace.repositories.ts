import type { TraceRepositories } from "../trace.repositories.ts";
import { MemoryTraceAnalyticsRepository } from "./memory.trace-analytics.repository.ts";
import { MemoryTraceAnalyticsRollupRepository } from "./memory.trace-analytics-rollup.repository.ts";
import { MemoryTraceEditOverlayRepository } from "./memory.trace-edit-overlay.repository.ts";
import { MemoryTraceSummaryProjectionRepository } from "./memory.trace-summary-projection.repository.ts";

/** The "memory" tier: every trace repository the app is tested without a database. */
export class MemoryTraceRepositories {
  static readonly requires = [] as const;

  static create(): TraceRepositories {
    return {
      editOverlay: MemoryTraceEditOverlayRepository.create(),
      summaryProjection: MemoryTraceSummaryProjectionRepository.create(),
      analyticsProjection: MemoryTraceAnalyticsRepository.create(),
      analyticsRollup: MemoryTraceAnalyticsRollupRepository.create(),
    };
  }
}
