import type { FoldProjectionStore } from "@langwatch/eventing";
import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import {
  TraceClickHouse,
  type TraceClickHouseClient,
} from "../clickhouse/clickhouse.trace-member-client.repository.ts";
import { NullLogRecordStorageRepository } from "../log-record-storage.repository.ts";
import { NullSessionGroupsRepository } from "../session-groups.repository.ts";
import type { TraceAnalyticsFoldCacheRepository } from "../trace-analytics-fold-cache.repository.ts";
import { TracePayloadReaderRepository } from "../trace-payload-reader.repository.ts";
import type { TraceSummaryFoldCacheRepository } from "../trace-summary-fold-cache.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { MemoryNullTraceAttributedRollupRepository } from "./memory.null-trace-attributed-rollup.repository.ts";
import { MemoryNullTraceClusteringSampleRepository } from "./memory.null-trace-clustering-sample.repository.ts";
import { MemoryNullTraceListRepository } from "./memory.null-trace-list.repository.ts";
import { MemorySpanStorageRepository } from "./memory.span-storage.repository.ts";
import { MemoryTraceAnalyticsRepository } from "./memory.trace-analytics-projection.repository.ts";
import { MemoryTraceAnalyticsRollupRepository } from "./memory.trace-analytics-rollup.repository.ts";
import { MemoryTraceAnnotationScoresRepository } from "./memory.trace-annotation-scores.repository.ts";
import { MemoryTraceAnnotationsRepository } from "./memory.trace-annotations.repository.ts";
import { MemoryTraceAttributeSpendRepository } from "./memory.trace-attribute-spend.repository.ts";
import { MemoryTraceDerivationSpanRepository } from "./memory.trace-derivation-span.repository.ts";
import { MemoryTraceEditOverlayRepository } from "./memory.trace-edit-overlay.repository.ts";
import { MemoryTraceEvaluationRunsRepository } from "./memory.trace-evaluation-runs.repository.ts";
import { MemoryTraceExistenceRepository } from "./memory.trace-existence.repository.ts";
import { MemoryTraceExportSlotRepository } from "./memory.trace-export-slot.repository.ts";
import { MemoryTraceIndexMaterialisationRepository } from "./memory.trace-index-materialisation.repository.ts";
import { MemoryTraceIngestSourceBillingRepository } from "./memory.trace-ingest-source-billing.repository.ts";
import { MemoryTraceInstantEvalRunsRepository } from "./memory.trace-instant-eval-runs.repository.ts";
import { MemoryTraceModelSpendRepository } from "./memory.trace-model-spend.repository.ts";
import { MemoryTraceRateLimitRepository } from "./memory.trace-rate-limit.repository.ts";
import { MemoryTraceSpanDedupRepository } from "./memory.trace-span-dedup.repository.ts";
import { MemoryTraceSpanStore } from "./memory.trace-span.store.ts";
import { MemoryTraceSummaryProjectionRepository } from "./memory.trace-summary-projection.repository.ts";
import { MemoryTraceSummaryRepository } from "./memory.trace-summary.repository.ts";
import { MemoryTraceTopicNamesRepository } from "./memory.trace-topic-names.repository.ts";
import { MemoryTraceUsageCountRepository } from "./memory.trace-usage-count.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
class MemoryTraceAnalyticsFoldCacheRepository implements TraceAnalyticsFoldCacheRepository {
  private constructor() {}

  static create(): MemoryTraceAnalyticsFoldCacheRepository {
    return new MemoryTraceAnalyticsFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}

/** The memory tier opens no ClickHouse: a raw tenant client is refused by name, never faked. */
class MemoryTraceClickHouseClientsRepository extends TraceClickHouse {
  static create(): MemoryTraceClickHouseClientsRepository {
    return new MemoryTraceClickHouseClientsRepository();
  }

  private constructor() {
    super();
  }

  resolve(): Promise<TraceClickHouseClient> {
    return Promise.reject(new TraceCapabilityUnavailableError("memory", "a ClickHouse client"));
  }
}

/**
 * Memory-backed payloads return null for offloaded fields: event_log is unavailable,
 * and callers treat absence as "never offloaded".
 */
class MemoryTracePayloadReaderRepository extends TracePayloadReaderRepository {
  static create(): MemoryTracePayloadReaderRepository {
    return new MemoryTracePayloadReaderRepository();
  }

  private constructor() {
    super();
  }

  async read(): Promise<string> {
    throw new Error("the memory trace repositories hold no offloaded payloads");
  }
}

/** No cache tier in memory: the durable store is already as fast as a cache. */
class MemoryTraceSummaryFoldCacheRepository implements TraceSummaryFoldCacheRepository {
  private constructor() {}

  static create(): MemoryTraceSummaryFoldCacheRepository {
    return new MemoryTraceSummaryFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}

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
      ingestSourceBilling: MemoryTraceIngestSourceBillingRepository.create(),
      summaryProjection: MemoryTraceSummaryProjectionRepository.create(),
      analyticsProjection: MemoryTraceAnalyticsRepository.create(),
      analyticsRollup: MemoryTraceAnalyticsRollupRepository.create(),
      summaryFoldCache: MemoryTraceSummaryFoldCacheRepository.create(),
      analyticsFoldCache: MemoryTraceAnalyticsFoldCacheRepository.create(),
      spanStorage: MemorySpanStorageRepository.create(spans),
      existence: MemoryTraceExistenceRepository.create(spans),
      derivationSpans: MemoryTraceDerivationSpanRepository.create(spans),
      summary: MemoryTraceSummaryRepository.create(),
      // Read-only over rows another module writes: with no writer in this
      // process there is nothing to read back, so the memory tier answers
      // empty rather than pretending to hold logs.
      logRecords: new NullLogRecordStorageRepository(),
      topicNames: MemoryTraceTopicNamesRepository.create(),
      instantEvalRuns: MemoryTraceInstantEvalRunsRepository.create(),
      evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
      annotations: MemoryTraceAnnotationsRepository.create(),
      annotationScores: MemoryTraceAnnotationScoresRepository.create(),
      // The list and the session rollup are ClickHouse aggregations over the
      // summary projection, which this tier does not fold: they answer empty
      // pages rather than a half-built rollup over the spans it does hold.
      list: MemoryNullTraceListRepository.create(),
      sessionGroups: new NullSessionGroupsRepository(),
      eventPayloads: MemoryTracePayloadReaderRepository.create(),
      clusteringSample: MemoryNullTraceClusteringSampleRepository.create(),
      usageCount: MemoryTraceUsageCountRepository.create(),
      indexMaterialisation: MemoryTraceIndexMaterialisationRepository.create(),
      modelSpend: MemoryTraceModelSpendRepository.create(),
      attributeSpend: MemoryTraceAttributeSpendRepository.create(),
      attributedRollup: MemoryNullTraceAttributedRollupRepository.create(),
      spanDedup: MemoryTraceSpanDedupRepository.create(),
      exportSlots: MemoryTraceExportSlotRepository.create(),
      rateLimits: MemoryTraceRateLimitRepository.create(),
      clickhouseClients: MemoryTraceClickHouseClientsRepository.create(),
    };
  }
}
