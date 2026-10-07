import { type Authorization, narrowAuthorization } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";

import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import { singleTenantOf } from "../clients/clickhouse/authorized-reads";
import type { BlobStore } from "./blob-store.service";
import { TraceNotFoundError } from "./errors";
import type { SpanStorageRepository } from "./repositories/span-storage.repository";
import type {
  FindByTraceIdParams,
  TraceSummaryRead,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
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

/**
 * A single-trace summary read. The proof fences the tenants the read may see
 * (ADR-144 block C); the summary row, the full read's span re-read and the
 * offloaded bodies are all read for it.
 */
export type GetByTraceIdParams = FindByTraceIdParams & {
  /**
   * Read-side visibility gate: summaries that occurred before this cutoff
   * get computed input/output/error teaser-redacted. Omitted/null = ungated
   * (internal callers).
   */
  visibilityCutoffMs?: number | null;
  /**
   * Resolve offloaded (ADR-022) input/output back to the full value. Only
   * meaningful on single-trace reads with full-resolution deps supplied at
   * construction; never used by list reads.
   */
  full?: boolean;
};

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

  /**
   * The proof one trace's detail reads are fenced by (ADR-144 block F).
   *
   * A proof that reads one project already is returned as it is, at no
   * cost. One that spans several, an aggregate's, is narrowed to the project
   * that holds the trace: the one the caller names (the list row and the
   * header both carry it), else the one this summary read finds, the same
   * pick the header's read makes. Every read behind one detail page then
   * stays on one member, even when two members hold the same trace id. The
   * member is found with a light seek on the summary's sort key, not the
   * heavy read: this runs on every un-named per-trace call under an
   * aggregate, every span tree page and live poll included.
   *
   * A named project the proof does not read returns null, for the route to
   * answer as not found. A trace no tenant holds keeps the proof as it is:
   * the reads that follow find nothing either way.
   */
  async authorizationForTrace({
    authorization,
    traceId,
    tenantId,
  }: {
    authorization: Authorization;
    traceId: string;
    /** The project that owns the trace, as the list row or header named it. */
    tenantId?: string;
  }): Promise<Authorization | null> {
    if (tenantId !== undefined) {
      return narrowAuthorization({ authorization, projectId: tenantId });
    }
    if (singleTenantOf({ authorization, reads: "traces" }) !== undefined) {
      return authorization;
    }
    const found = await this.repository.findTenantIdByTraceId({
      authorization,
      traceId,
    });
    if (found === null) return authorization;
    return narrowAuthorization({ authorization, projectId: found });
  }

  async getByTraceId({
    visibilityCutoffMs,
    full,
    ...read
  }: GetByTraceIdParams): Promise<TraceSummaryRead> {
    const result = await this.repository.findByTraceId(read);
    if (!result) throw new TraceNotFoundError(read.traceId);

    const cutoff = visibilityCutoffMs;
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

    if (full && this.fullResolutionDeps) {
      return await this.withFullIO({
        authorization: read.authorization,
        summary: result,
      });
    }
    return result;
  }

  /**
   * Recomputes input/output from the trace's spans with offloaded values
   * restored. Any failure — spans read, event_log read, a stale ref — falls
   * back to the stored preview: a degraded header read must never become a
   * failed one.
   *
   * The span re-read and the offloaded bodies are narrowed to the tenant the
   * summary was read from (ADR-144 block F): on an aggregate the spans are
   * the same member's, and the bodies, which live under a project id outside
   * ClickHouse, are resolved for that member rather than for the aggregate.
   * The bodies are only ever looked up for spans the fenced read returned.
   */
  private async withFullIO({
    authorization,
    summary,
  }: {
    authorization: Authorization;
    summary: TraceSummaryRead;
  }): Promise<TraceSummaryRead> {
    const deps = this.fullResolutionDeps;
    if (!deps) return summary;
    try {
      const narrowed = narrowAuthorization({
        authorization,
        projectId: summary.tenantId,
      });
      if (!narrowed) return summary;
      const normalizedSpans =
        await deps.spanStorageRepository.getNormalizedSpansByTraceId({
          authorization: narrowed,
          traceId: summary.traceId,
          occurredAtMs: summary.occurredAt,
        });
      const { recomputedInput, recomputedOutput, anyResolved } =
        await resolveOffloadedTraces({
          projectId: summary.tenantId,
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
        { error, traceId: summary.traceId },
        "full-resolution summary read failed; returning stored preview",
      );
      return summary;
    }
  }
}
