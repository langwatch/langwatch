import { createLogger } from "@langwatch/observability";

import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import type { BlobStore } from "./blob-store.service";
import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { SpanStorageRepository } from "./repositories/span-storage.repository";
import type { TraceIOExtractionService } from "./trace-io-extraction.service";
import type { TraceSummaryData } from "./types";
import { teaserOf } from "./visibility-window.service";

/**
 * Optional blob-offload resolution dependencies for the `full` read path
 * (ADR-022). When provided, `getByTraceId({ full: true })` re-reads the
 * trace's spans, resolves any `langwatch.reserved.eventref.*` pointers from
 * event_log, and recomputes input/output so the header shows the complete
 * content instead of the ≤64KB preview stored in trace_summaries. When
 * omitted, `full` is a no-op — identical to the plain summary read.
 */
export interface TraceSummaryFullResolutionDeps {
  spanStorageRepository: SpanStorageRepository;
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
}

export class TraceSummaryService {
  private readonly logger = createLogger(
    "langwatch:traces:trace-summary-service",
  );

  constructor(
    readonly repository: TraceSummaryRepository,
    private readonly fullResolutionDeps?: TraceSummaryFullResolutionDeps,
  ) {}

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions & {
      /**
       * Read-side visibility gate: summaries that occurred before this
       * cutoff get computed input/output/error teaser-redacted.
       * Omitted/null = ungated (internal callers).
       */
      visibilityCutoffMs?: number | null;
      /**
       * Resolve offloaded (ADR-022) input/output back to the full value.
       * Only meaningful on single-trace reads with full-resolution deps
       * supplied at construction; never used by list reads.
       */
      full?: boolean;
    },
  ): Promise<TraceSummaryData> {
    const result = await this.repository.findByTraceId(
      tenantId,
      traceId,
      options,
    );
    if (!result) throw new TraceNotFoundError(traceId);

    const cutoff = options?.visibilityCutoffMs;
    if (cutoff !== null && cutoff !== undefined && result.occurredAt < cutoff) {
      // Gated reads get a teaser regardless — resolving the full value only
      // to redact it would be a wasted spans + event_log read.
      return {
        ...result,
        computedInput: result.computedInput
          ? teaserOf(result.computedInput)
          : result.computedInput,
        computedOutput: result.computedOutput
          ? teaserOf(result.computedOutput)
          : result.computedOutput,
        errorMessage: result.errorMessage
          ? teaserOf(result.errorMessage)
          : result.errorMessage,
        redactedByVisibilityWindow: true,
      };
    }

    if (options?.full && this.fullResolutionDeps) {
      return await this.withFullIO(tenantId, result);
    }
    return result;
  }

  /**
   * Recomputes input/output from the trace's spans with offloaded values
   * restored. Any failure — spans read, event_log read, a stale ref — falls
   * back to the stored preview: a degraded header read must never become a
   * failed one.
   */
  private async withFullIO(
    tenantId: string,
    summary: TraceSummaryData,
  ): Promise<TraceSummaryData> {
    const deps = this.fullResolutionDeps;
    if (!deps) return summary;
    try {
      const normalizedSpans =
        await deps.spanStorageRepository.getNormalizedSpansByTraceId({
          tenantId,
          traceId: summary.traceId,
          occurredAtMs: summary.occurredAt,
        });
      const { recomputedInput, recomputedOutput, anyResolved } =
        await resolveOffloadedTraces({
          projectId: tenantId,
          normalizedSpans,
          blobStore: deps.blobStore,
          ioExtractionService: deps.ioExtractionService,
          logger: this.logger,
        });
      if (!anyResolved) return summary;
      return {
        ...summary,
        ...(recomputedInput !== null
          ? { computedInput: recomputedInput.text }
          : {}),
        ...(recomputedOutput !== null
          ? { computedOutput: recomputedOutput.text }
          : {}),
      };
    } catch (error) {
      this.logger.warn(
        { error, tenantId, traceId: summary.traceId },
        "full-resolution summary read failed; returning stored preview",
      );
      return summary;
    }
  }
}
