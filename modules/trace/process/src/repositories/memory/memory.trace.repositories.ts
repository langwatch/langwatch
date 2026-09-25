import { NullLogRecordStorageRepository } from "../log-record-storage.repository.ts";
import { NullSessionGroupsRepository } from "../session-groups.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { MemoryNullTraceClusteringSampleRepository } from "./memory.null-trace-clustering-sample.repository.ts";
import { MemoryNullTraceListRepository } from "./memory.null-trace-list.repository.ts";
import { MemorySpanStorageRepository } from "./memory.span-storage.repository.ts";
import { MemoryTraceAnalyticsRollupRepository } from "./memory.trace-analytics-rollup.repository.ts";
import { MemoryTraceAnalyticsRepository } from "./memory.trace-analytics.repository.ts";
import { MemoryTraceDerivationSpanRepository } from "./memory.trace-derivation-span.repository.ts";
import { MemoryTraceEditOverlayRepository } from "./memory.trace-edit-overlay.repository.ts";
import { MemoryTraceExistenceRepository } from "./memory.trace-existence.repository.ts";
import { MemoryTraceModelSpendRepository } from "./memory.trace-model-spend.repository.ts";
import { MemoryTracePayloadReaderRepository } from "./memory.trace-payload-reader.repository.ts";
import { MemoryTraceSpanStore } from "./memory.trace-span.store.ts";
import { MemoryTraceSummaryProjectionRepository } from "./memory.trace-summary-projection.repository.ts";
import { MemoryTraceSummaryRepository } from "./memory.trace-summary.repository.ts";
import { MemoryTraceUsageCountRepository } from "./memory.trace-usage-count.repository.ts";

/** The "memory" tier: every trace repository the app is tested without a database. */
export class MemoryTraceRepositories {
  static readonly requires = [] as const;

  static create(): TraceRepositories {
    // One store behind the three span-backed rows, the way one ClickHouse
    // connection serves them: a span written through `spanStorage` is what
    // `existence` and `derivationSpans` answer from.
    const spans = MemoryTraceSpanStore.create();

    return {
      editOverlay: MemoryTraceEditOverlayRepository.create(),
      summaryProjection: MemoryTraceSummaryProjectionRepository.create(),
      analyticsProjection: MemoryTraceAnalyticsRepository.create(),
      analyticsRollup: MemoryTraceAnalyticsRollupRepository.create(),
      spanStorage: MemorySpanStorageRepository.create(spans),
      existence: MemoryTraceExistenceRepository.create(spans),
      derivationSpans: MemoryTraceDerivationSpanRepository.create(spans),
      summary: MemoryTraceSummaryRepository.create(),
      // Read-only over rows another module writes: with no writer in this
      // process there is nothing to read back, so the memory tier answers
      // empty rather than pretending to hold logs.
      logRecords: new NullLogRecordStorageRepository(),
      // The list and the session rollup are ClickHouse aggregations over the
      // summary projection, which this tier does not fold: they answer empty
      // pages rather than a half-built rollup over the spans it does hold.
      list: MemoryNullTraceListRepository.create(),
      sessionGroups: new NullSessionGroupsRepository(),
      eventPayloads: MemoryTracePayloadReaderRepository.create(),
      clusteringSample: MemoryNullTraceClusteringSampleRepository.create(),
      usageCount: MemoryTraceUsageCountRepository.create(),
      modelSpend: MemoryTraceModelSpendRepository.create(),
    };
  }
}
