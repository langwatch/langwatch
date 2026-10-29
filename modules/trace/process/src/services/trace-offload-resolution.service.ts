import { createLogger, type Logger as PinoLogger } from "@langwatch/observability";
import type { NormalizedSpan } from "@langwatch/trace-contract";

import type { ExtractedIO } from "#features/conversation/rules/trace-io-text.rules";
import type { TraceIOExtractionService } from "#features/derivation/services/trace-io-extraction.service";

/**
 * Read-time recompute of offloaded trace event refs (ADR-022). Ingestion writes the full event to
 * event_log and leans projections, so the fold holds preview IO; the read path resolves the
 * pointers and re-runs IO extraction. A missing row logs at warn and keeps the preview.
 */
import type { ResolveTraceSpansFn } from "../features/legacy/repositories/trace-legacy-read.repository.ts";
import type { BlobResolutionDeps } from "../features/legacy/services/trace-legacy-read.service.ts";
import type { TraceBlobStoreService } from "../features/media/services/trace-blob-store.service.ts";
import { hasEventRefs } from "../rules/trace-event-ref-parsing.rules.ts";
import { TraceOffloadResolutionBatchService } from "./trace-offload-resolution-batch.service.ts";

const offloadResolutionLogger = createLogger("langwatch:traces:clickhouse-legacy-read");

/** Minimal logger interface required by this module (subset of PinoLogger). */
export type WarnLogger = Pick<PinoLogger, "warn" | "error">;

/**
 * Result of resolving offloaded blobs for a single trace's spans.
 */
export interface ResolvedTraceSpans {
  /** Spans with full attribute values restored (refs stripped). */
  resolvedSpans: NormalizedSpan[];
  /**
   * Recomputed trace-level input from the resolved spans, or null when no
   * event refs were present / resolution failed.
   */
  recomputedInput: ExtractedIO | null;
  /**
   * Recomputed trace-level output from the resolved spans, or null when no
   * event refs were present / resolution failed.
   */
  recomputedOutput: ExtractedIO | null;
  /**
   * True when at least one span had event refs successfully resolved. When false,
   * `recomputedInput`/`recomputedOutput` are null and the preview values
   * stored in trace_summaries should remain in effect.
   */
  anyResolved: boolean;
}

export class TraceOffloadResolutionService {
  static create(): TraceOffloadResolutionService {
    return new TraceOffloadResolutionService();
  }

  private constructor() {}

  /** The per-trace resolver a legacy read calls, bound to one blob store. */
  resolverFor(deps: BlobResolutionDeps): ResolveTraceSpansFn {
    return (projectId, normalizedSpans) =>
      this.resolveOffloadedTraces({
        projectId,
        normalizedSpans,
        blobStore: deps.blobStore,
        ioExtractionService: deps.ioExtractionService,
        logger: offloadResolutionLogger,
      });
  }

  /**
   * Resolves offloaded event refs for one trace's normalized spans, replacing spanAttributes with
   * the resolved map and re-running IO extraction when any span resolved. A field that cannot be
   * recalled keeps its preview and is logged at warn, never propagated.
   */
  async resolveOffloadedTraces({
    projectId,
    normalizedSpans,
    blobStore,
    ioExtractionService,
    logger,
  }: {
    projectId: string;
    normalizedSpans: NormalizedSpan[];
    blobStore: TraceBlobStoreService;
    ioExtractionService: TraceIOExtractionService;
    logger: WarnLogger;
  }): Promise<ResolvedTraceSpans> {
    // Fast path: no span in this trace has any event ref, so there is nothing to resolve.
    const anyHasRefs = normalizedSpans.some((span) => hasEventRefs(span.spanAttributes));
    if (!anyHasRefs) {
      return {
        resolvedSpans: normalizedSpans,
        recomputedInput: null,
        recomputedOutput: null,
        anyResolved: false,
      };
    }

    // One trace is a result set of one: the same single recall per event, bounded pool and
    // per-trace budget, rather than a fetch per field with every span in flight at once.
    const [resolved] =
      await TraceOffloadResolutionBatchService.create().resolveOffloadedTracesBatch({
        projectId,
        spansPerTrace: [normalizedSpans],
        blobStore,
        ioExtractionService,
        logger,
      });
    return resolved!;
  }
}
