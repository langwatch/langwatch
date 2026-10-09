import type { Authorization } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import { teaserOf, TraceNotFoundError } from "@langwatch/trace-contract";

import type { SpanStorageRepository } from "../../../repositories/span-storage.repository.ts";
import type {
  FindByTraceIdParams,
  TraceSummaryRead,
  TraceSummaryRepository,
} from "../../../repositories/trace-summary.repository.ts";
import { TraceOffloadResolutionService } from "../../../services/trace-offload-resolution.service.ts";
import type { TraceIOExtractionService } from "../../derivation/services/trace-io-extraction.service.ts";
import type { TraceBlobStoreService } from "../../media/services/trace-blob-store.service.ts";

/**
 * Optional blob-offload resolution dependencies for the `full` read path (ADR-022). When provided,
 * `getByTraceId({ full: true })` re-reads the trace's spans, resolves `eventref` pointers from
 * event_log and recomputes input and output. When omitted, `full` is a plain summary read.
 */
interface TraceSummaryFullResolutionDeps {
  spanStorageRepository: SpanStorageRepository;
  blobStore: TraceBlobStoreService;
  ioExtractionService: TraceIOExtractionService;
}

/** A single-trace summary read, fenced by the route's proof (ADR-175). */
export type GetByTraceIdParams = FindByTraceIdParams & {
  /**
   * Read-side visibility gate: summaries that occurred before this cutoff get computed
   * input/output/error teaser-redacted. Omitted/null = ungated (internal callers).
   */
  visibilityCutoffMs?: number | null;
  /**
   * Resolve offloaded (ADR-022) input/output back to the full value. Only meaningful on
   * single-trace reads with full-resolution deps supplied at construction; never on list reads.
   */
  full?: boolean;
};

export class TraceSummaryService {
  static create({
    repository,
    fullResolutionDeps,
  }: {
    repository: TraceSummaryRepository;
    fullResolutionDeps?: TraceSummaryFullResolutionDeps;
  }): TraceSummaryService {
    return new TraceSummaryService(repository, fullResolutionDeps);
  }

  private readonly logger = createLogger("langwatch:traces:trace-summary-service");

  private constructor(
    readonly repository: TraceSummaryRepository,
    private readonly fullResolutionDeps?: TraceSummaryFullResolutionDeps,
  ) {}

  async getByTraceId({
    visibilityCutoffMs,
    full,
    ...read
  }: GetByTraceIdParams): Promise<TraceSummaryRead> {
    const result = await this.repository.findByTraceId(read);
    if (!result) {
      throw new TraceNotFoundError(read.traceId);
    }

    const cutoff = visibilityCutoffMs;
    if (cutoff !== null && cutoff !== undefined && result.occurredAt < cutoff) {
      // Gated reads get a teaser regardless — resolving the full value only
      // to redact it would be a wasted spans + event_log read.
      return {
        ...result,
        computedInput: result.computedInput ? teaserOf(result.computedInput) : result.computedInput,
        computedOutput: result.computedOutput
          ? teaserOf(result.computedOutput)
          : result.computedOutput,
        errorMessage: result.errorMessage ? teaserOf(result.errorMessage) : result.errorMessage,
        redactedByVisibilityWindow: true,
      };
    }

    if (full && this.fullResolutionDeps) {
      return this.withFullIO({ authorization: read.authorization, summary: result });
    }

    return result;
  }

  /**
   * Recomputes input and output from the trace's spans with offloaded values restored. Any failure
   * falls back to the stored preview: a degraded header read must never become a failed one. The
   * spans and offloaded bodies are the project's the summary was read from.
   */
  private async withFullIO({
    authorization,
    summary,
  }: {
    authorization: Authorization;
    summary: TraceSummaryRead;
  }): Promise<TraceSummaryRead> {
    const deps = this.fullResolutionDeps;
    if (!deps) {
      return summary;
    }

    try {
      const fencedSpans = await deps.spanStorageRepository.findNormalizedSpansByTraceId({
        authorization,
        traceId: summary.traceId,
        occurredAtMs: summary.occurredAt,
      });
      // On an aggregate two members may hold the trace id; recompute from this summary's.
      const normalizedSpans = fencedSpans.filter((span) => span.tenantId === summary.tenantId);
      const { recomputedInput, recomputedOutput, anyResolved } =
        await TraceOffloadResolutionService.create().resolveOffloadedTraces({
          projectId: summary.tenantId,
          normalizedSpans,
          blobStore: deps.blobStore,
          ioExtractionService: deps.ioExtractionService,
          logger: this.logger,
        });
      if (!anyResolved) {
        return summary;
      }

      return {
        ...summary,
        ...(recomputedInput !== null ? { computedInput: recomputedInput.text } : {}),
        ...(recomputedOutput !== null ? { computedOutput: recomputedOutput.text } : {}),
      };
    } catch (error) {
      this.logger.warn(
        { error, tenantId: summary.tenantId, traceId: summary.traceId },
        "full-resolution summary read failed; returning stored preview",
      );

      return summary;
    }
  }
}
