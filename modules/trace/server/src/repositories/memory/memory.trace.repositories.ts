import { NullLogRecordStorageRepository } from "../log-record-storage.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { MemorySpanStorageRepository } from "./read/memory.span-storage.repository.ts";
import { MemoryTraceDerivationSpanRepository } from "./read/memory.trace-derivation-span.repository.ts";
import { MemoryTraceExistenceRepository } from "./read/memory.trace-existence.repository.ts";
import { MemoryTraceSpanStore } from "./read/memory-trace-span.store.ts";
import { MemoryTraceSummaryRepository } from "./read/memory.trace-summary.repository.ts";
import { MemoryTraceAnalyticsRepository } from "./memory.trace-analytics.repository.ts";
import { MemoryTraceAnalyticsRollupRepository } from "./memory.trace-analytics-rollup.repository.ts";
import { MemoryTraceEditOverlayRepository } from "./memory.trace-edit-overlay.repository.ts";
import { MemoryTraceSummaryProjectionRepository } from "./memory.trace-summary-projection.repository.ts";
import { MemoryTracePayloadReaderRepository } from "./read/memory.trace-payload-reader.repository.ts";
import { NullSessionGroupsRepository } from "../session-groups.repository.ts";
import { NullTraceListAdapter } from "./null-trace-list.adapter.ts";

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
      list: NullTraceListAdapter.create(),
      sessionGroups: new NullSessionGroupsRepository(),
      eventPayloads: MemoryTracePayloadReaderRepository.create(),
    };
  }
}
