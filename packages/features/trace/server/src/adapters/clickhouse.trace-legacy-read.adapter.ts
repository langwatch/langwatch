import type { ClickHouseClient } from "@clickhouse/client";
import type { AnnotationService } from "@langwatch/annotation-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { createLogger } from "@langwatch/observability";
import type { NormalizedSpan, TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  TraceLegacyReadClickHouseRepository,
  type TraceLegacyFilterConditions,
} from "../repositories/clickhouse/trace-legacy-read.repository";
import type { TraceLegacyReadRepository } from "../repositories/trace-legacy-read.repository";
import type { BlobResolutionDeps } from "../services/trace-legacy-read.service";
import { TraceOffloadResolutionBatchService } from "../services/trace-offload-resolution-batch.service";
import { TraceOffloadResolutionService } from "../services/trace-offload-resolution.service";

const logger = createLogger("langwatch:traces:clickhouse-legacy-read");

/**
 * @see ADR-022
 * Builds per-trace and bulk resolver callbacks from the blob-offload dependencies: given a project and a trace's normalized spans, restores the field values leanForProjection offloaded to event_log and recomputes trace IO from the resolved spans. Absent, the store falls back to the preview values on trace_summaries.
 */
class OffloadedSpanResolver {
  constructor(private readonly deps: BlobResolutionDeps) {}

  toResolverFn(): (
    projectId: string,
    normalizedSpans: NormalizedSpan[],
  ) => ReturnType<typeof TraceOffloadResolutionService.resolveOffloadedTraces> {
    return (projectId, normalizedSpans) =>
      TraceOffloadResolutionService.resolveOffloadedTraces({
        projectId,
        normalizedSpans,
        blobStore: this.deps.blobStore,
        ioExtractionService: this.deps.ioExtractionService,
        logger,
      });
  }

  toBatchResolverFn(): (
    projectId: string,
    spansPerTrace: NormalizedSpan[][],
  ) => ReturnType<typeof TraceOffloadResolutionBatchService.resolveOffloadedTracesBatch> {
    return (projectId, spansPerTrace) =>
      TraceOffloadResolutionBatchService.resolveOffloadedTracesBatch({
        projectId,
        spansPerTrace,
        blobStore: this.deps.blobStore,
        ioExtractionService: this.deps.ioExtractionService,
        logger,
      });
  }
}

export interface ClickHouseTraceLegacyReadOptions {
  traceCanonicalisation: TraceCanonicalisationService;
  /** The process's tenant-keyed connection; absent, every read refuses. */
  resolveClickHouseClient?: ((tenantId: string) => Promise<ClickHouseClient>) | undefined;
  /** The analytics filter translator; absent, a FILTERED list refuses. */
  filterConditions?: TraceLegacyFilterConditions | undefined;
  blobResolutionDeps?: BlobResolutionDeps;
  retentionResolver?: DataRetentionService;
  annotationService?: AnnotationService;
}

/** Composes the legacy trace read over ClickHouse for a composition root. */
export class ClickHouseTraceLegacyReadAdapter {
  static create(options: ClickHouseTraceLegacyReadOptions): TraceLegacyReadRepository {
    const offloadedSpanResolver =
      options.blobResolutionDeps !== undefined
        ? new OffloadedSpanResolver(options.blobResolutionDeps)
        : undefined;

    return new TraceLegacyReadClickHouseRepository({
      resolveClickHouseClient: options.resolveClickHouseClient,
      filterConditions: options.filterConditions,
      resolveTraceSpans: offloadedSpanResolver?.toResolverFn(),
      resolveTraceSpansBatch: offloadedSpanResolver?.toBatchResolverFn(),
      retentionResolver: options.retentionResolver,
      annotations: options.annotationService,
      traceCanonicalisation: options.traceCanonicalisation,
    });
  }
}
