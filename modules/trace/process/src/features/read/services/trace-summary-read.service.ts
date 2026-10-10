import {
  type Authorization,
  narrowAuthorization,
  projectIdsReadBy,
} from "@langwatch/authorization";
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

type GetByTraceIdParams = FindByTraceIdParams & {
  /** Summaries that occurred before this cutoff are teaser-redacted; omitted or null = ungated. */
  visibilityCutoffMs?: number | null;
  /** Resolve offloaded (ADR-022) input/output back to the full value; single-trace reads only. */
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

  /**
   * The proof one trace's detail reads are fenced by (ADR-177): an aggregate's is narrowed to the
   * member holding the trace (named, else found by a light seek). A named project the proof does
   * not read is not found; a trace no member holds keeps the proof as it is.
   */
  async getTraceAuthorization({
    authorization,
    traceId,
    tenantId,
  }: {
    authorization: Authorization;
    traceId: string;
    /** The project that owns the trace, as the list row or header named it. */
    tenantId?: string;
  }): Promise<Authorization> {
    if (tenantId === undefined && projectIdsReadBy(authorization).length === 1) {
      return authorization;
    }
    const projectId =
      tenantId ?? (await this.repository.findTenantIdsByTraceId({ authorization, traceId }))[0];
    if (projectId === undefined) {
      return authorization;
    }
    const narrowed = narrowAuthorization({ authorization, projectId });
    if (narrowed === null) {
      throw new TraceNotFoundError(traceId);
    }

    return narrowed;
  }

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
   * falls back to the stored preview. The span re-read and the bodies are for the member the
   * summary was read from (ADR-177).
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
      const narrowed = narrowAuthorization({ authorization, projectId: summary.tenantId });
      if (narrowed === null) {
        return summary;
      }
      const normalizedSpans = await deps.spanStorageRepository.findNormalizedSpansByTraceId({
        authorization: narrowed,
        traceId: summary.traceId,
        occurredAtMs: summary.occurredAt,
      });
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
        { error, traceId: summary.traceId },
        "full-resolution summary read failed; returning stored preview",
      );

      return summary;
    }
  }
}
