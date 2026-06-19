import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import {
  mapNormalizedSpansToSpans,
  mapNormalizedSpanToSpan,
} from "~/server/traces/mappers/span.mapper";
import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import { createLogger } from "~/utils/logger/server";
import { redactSpanContent } from "./visibility-window.service";
import type { BlobStore } from "./blob-store.service";
import type {
  ModelSpanSampleRow,
  ModelUsageStatsRow,
  OccurredAtHint,
  SpanLangwatchSignalsRow,
  SpanResourceInfo,
  SpanStorageRepository,
  SpanSummaryRow,
} from "./repositories/span-storage.repository";
import type { TraceIOExtractionService } from "./trace-io-extraction.service";
import type { SpanInsertData } from "./types";

/**
 * Optional blob-offload resolution dependencies for the v2 read path (ADR-022).
 *
 * When provided, `getSpansByTraceId` and `getSpanById` resolve any
 * `langwatch.reserved.eventref.*` pointers before mapping to `Span[]`.
 * When omitted, the service falls back to the preview values already stored
 * in `stored_spans` — identical to pre-ADR-022 behaviour.
 */
export interface SpanReadBlobResolutionDeps {
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
}

type ByTraceId = { tenantId: string; traceId: string } & OccurredAtHint;
type BySpanId = ByTraceId & { spanId: string };
type Paginated = ByTraceId & { limit: number; offset: number };
type Since = ByTraceId & { sinceStartTimeMs: number };

/**
 * Read-side visibility gate. Read routes pass the caller's plan cutoff
 * (from `getVisibilityCutoffMsForProject`); spans started before it get
 * their content teaser-redacted. Omitted/null = ungated — internal callers
 * (ingestion, enrichment, derivations) never pass it.
 */
type VisibilityGate = { visibilityCutoffMs?: number | null };

const applyVisibilityGate = <T extends Span>(
  spans: T[],
  visibilityCutoffMs: number | null | undefined,
): T[] => {
  if (visibilityCutoffMs === null || visibilityCutoffMs === undefined) {
    return spans;
  }
  return spans.map((span) =>
    span.timestamps.started_at < visibilityCutoffMs
      ? redactSpanContent(span)
      : span,
  );
};

export class SpanStorageService {
  private readonly blobResolutionDeps?: SpanReadBlobResolutionDeps;
  private readonly logger = createLogger(
    "langwatch:traces:span-storage-service",
  );

  constructor(
    readonly repository: SpanStorageRepository,
    blobResolutionDeps?: SpanReadBlobResolutionDeps,
  ) {
    this.blobResolutionDeps = blobResolutionDeps;
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  /**
   * Returns full spans for a trace, resolving any ADR-022 offloaded eventref
   * pointers when `blobResolutionDeps` were supplied at construction.
   *
   * Resolution is a no-op when no span in the trace carries a
   * `langwatch.reserved.eventref.*` attribute — the cost is one
   * `getNormalizedSpansByTraceId` call instead of `getSpansByTraceId`.
   * On resolution failure (missing event_log row) the preview value is
   * kept in place and the error is logged at warn level; the call never
   * throws due to a stale ref.
   */
  async getSpansByTraceId(
    params: ByTraceId & { limit?: number } & VisibilityGate,
  ): Promise<Span[]> {
    if (!this.blobResolutionDeps) {
      return applyVisibilityGate(
        await this.repository.getSpansByTraceId(params),
        params.visibilityCutoffMs,
      );
    }

    // Fetch normalized spans so resolution can access raw spanAttributes.
    const normalizedSpans =
      await this.repository.getNormalizedSpansByTraceId(params);
    const { resolvedSpans } = await resolveOffloadedTraces({
      projectId: params.tenantId,
      normalizedSpans,
      blobStore: this.blobResolutionDeps.blobStore,
      ioExtractionService: this.blobResolutionDeps.ioExtractionService,
      logger: this.logger,
    });
    return applyVisibilityGate(
      mapNormalizedSpansToSpans(resolvedSpans),
      params.visibilityCutoffMs,
    );
  }

  async getNormalizedSpansByTraceId(
    params: ByTraceId & { limit?: number },
  ): Promise<NormalizedSpan[]> {
    return this.repository.getNormalizedSpansByTraceId(params);
  }

  /**
   * Returns a single span by its ID, resolving any ADR-022 offloaded eventref
   * pointers when `blobResolutionDeps` were supplied at construction.
   *
   * Resolution fetches normalized spans for the whole trace and isolates the
   * requested span after resolution — this reuses the same
   * `resolveOffloadedTraces` path as `getSpansByTraceId` so that sibling
   * eventref pointers on the same trace are also resolved consistently.
   */
  async getSpanById(params: BySpanId & VisibilityGate): Promise<Span | null> {
    const gateOne = (span: Span | null): Span | null =>
      span
        ? (applyVisibilityGate([span], params.visibilityCutoffMs)[0] ?? null)
        : null;

    if (!this.blobResolutionDeps) {
      return gateOne(await this.repository.getSpanByIds(params));
    }

    // Resolve the single span via the normalized+resolve path.
    const normalizedSpans =
      await this.repository.getNormalizedSpansByTraceId(params);
    const { resolvedSpans } = await resolveOffloadedTraces({
      projectId: params.tenantId,
      normalizedSpans,
      blobStore: this.blobResolutionDeps.blobStore,
      ioExtractionService: this.blobResolutionDeps.ioExtractionService,
      logger: this.logger,
    });
    const resolved = resolvedSpans.find((s) => s.spanId === params.spanId);
    if (!resolved) return null;
    return gateOne(mapNormalizedSpanToSpan(resolved));
  }

  async getTraceEventsByTraceId(
    params: ByTraceId,
  ): Promise<DerivedTraceEvent[]> {
    return this.repository.getTraceEventsByTraceId(params);
  }

  async getEventsByTraceId(params: ByTraceId): Promise<ElasticSearchEvent[]> {
    return this.repository.getEventsByTraceId(params);
  }

  async getSpanEvents(params: BySpanId): Promise<ElasticSearchEvent[]> {
    return this.repository.getSpanEvents(params);
  }

  async getSpanSummaryByTraceId(params: ByTraceId): Promise<SpanSummaryRow[]> {
    return this.repository.getSpanSummaryByTraceId(params);
  }

  async getLangwatchSignalsByTraceId(
    params: ByTraceId,
  ): Promise<SpanLangwatchSignalsRow[]> {
    return this.repository.findLangwatchSignalsByTraceId(params);
  }

  async getSpanResourcesByTraceId(
    params: ByTraceId,
  ): Promise<SpanResourceInfo[]> {
    return this.repository.findSpanResourcesByTraceId(params);
  }

  async getSpansPaginated(
    params: Paginated & VisibilityGate,
  ): Promise<{ spans: Span[]; total: number }> {
    const page = await this.repository.findSpansPaginated(params);
    return {
      ...page,
      spans: applyVisibilityGate(page.spans, params.visibilityCutoffMs),
    };
  }

  async getSpansSince(params: Since & VisibilityGate): Promise<Span[]> {
    return applyVisibilityGate(
      await this.repository.findSpansSince(params),
      params.visibilityCutoffMs,
    );
  }

  async getSpanSummariesPaginated(
    params: Paginated,
  ): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    return this.repository.findSpanSummariesPaginated(params);
  }

  async getSpanSummariesSince(params: Since): Promise<SpanSummaryRow[]> {
    return this.repository.findSpanSummariesSince(params);
  }

  async getModelUsageStats(params: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return this.repository.findModelUsageStats(params);
  }

  async getRecentSpansByModels(params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return this.repository.findRecentSpansByModels(params);
  }
}
