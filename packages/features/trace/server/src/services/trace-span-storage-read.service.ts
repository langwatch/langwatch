import { VisibilityWindowService } from "./trace-visibility-window.service";
import { TraceOffloadResolutionService } from "./trace-offload-resolution.service";
import { TraceLegacySpanMappingService } from "./trace-legacy-span-mapping.service";
import { createLogger } from "@langwatch/observability";
import type { DerivedTraceEvent } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import type { ElasticSearchEvent, Span } from "@langwatch/trace-contract";
import type { TraceBlobStoreService } from "./trace-blob-store.service";
import type {
  ModelSpanSampleRow,
  ModelUsageStatsRow,
  NormalizedSpanByIdParams,
  OccurredAtHint,
  SpanLangwatchSignalsRow,
  SpanStorageRepository,
  TraceEventRollupParams,
} from "../repositories/span-storage.repository";
import type { SpanResourceInfo, SpanSummaryRow, TraceEventRollup } from "@langwatch/trace-contract";
import type { TraceIOExtractionService } from "./trace-io-extraction.service";
import type { SpanInsertData } from "@langwatch/trace-contract";

/**
 * Optional blob-offload resolution dependencies for the v2 read path (ADR-022). When provided, the
 * span reads resolve any `langwatch.reserved.eventref.*` pointers before mapping; when omitted the
 * service falls back to the preview values already stored, exactly as before ADR-022.
 */
export interface SpanReadBlobResolutionDeps {
  blobStore: TraceBlobStoreService;
  ioExtractionService: TraceIOExtractionService;
}

type ByTraceId = { tenantId: string; traceId: string } & OccurredAtHint;
type BySpanId = ByTraceId & { spanId: string };
type Paginated = ByTraceId & { limit: number; offset: number };
/** Full-span delta: keyed on span start (see `findSpansSince`). */
type Since = ByTraceId & { sinceStartTimeMs: number };
/**
 * Span-summary delta: keyed on the ROW VERSION, so spans updated in place
 * (end time, duration, status, cost) are picked up too — a start-keyed poll
 * only ever sees brand-new spans.
 */

/**
 * Read-side visibility gate. Read routes pass the caller's plan cutoff and spans started before it
 * get their content teaser-redacted. Omitted or null means ungated: internal callers such as
 * ingestion, enrichment and derivations never pass it.
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
      ? VisibilityWindowService.redactSpanContent(span)
      : span,
  );
};

export class SpanStorageService {
  static create({
    repository,
    blobResolutionDeps,
  }: {
    repository: SpanStorageRepository;
    blobResolutionDeps?: SpanReadBlobResolutionDeps;
  }): SpanStorageService {
    return new SpanStorageService(repository, blobResolutionDeps);
  }

  private readonly blobResolutionDeps?: SpanReadBlobResolutionDeps;
  private readonly logger = createLogger("langwatch:traces:span-storage-service");

  private constructor(
    readonly repository: SpanStorageRepository,
    blobResolutionDeps?: SpanReadBlobResolutionDeps,
  ) {
    this.blobResolutionDeps = blobResolutionDeps;
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  /**
   * Full spans for a trace, resolving ADR-022 offloaded eventref pointers when the resolution
   * dependencies were supplied. A no-op when no span carries one. On a missing event_log row the
   * preview value is kept and the error logged at warn; a stale ref never throws.
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
    const normalizedSpans = await this.repository.getNormalizedSpansByTraceId(params);
    const { resolvedSpans } = await TraceOffloadResolutionService.resolveOffloadedTraces({
      projectId: params.tenantId,
      normalizedSpans,
      blobStore: this.blobResolutionDeps.blobStore,
      ioExtractionService: this.blobResolutionDeps.ioExtractionService,
      logger: this.logger,
    });

    return applyVisibilityGate(
      TraceLegacySpanMappingService.mapNormalizedSpansToSpans(resolvedSpans),
      params.visibilityCutoffMs,
    );
  }

  async getNormalizedSpansByTraceId(
    params: ByTraceId & { limit?: number },
  ): Promise<NormalizedSpan[]> {
    return this.repository.getNormalizedSpansByTraceId(params);
  }

  /**
   * Claim-check resolution read (ADR-069): one canonical span by identity for internal derivation
   * consumers. Deliberately ungated and unresolved, and `null` means not readable yet so queue
   * callers retry. The partition hint is required: the read behind it has no unbounded fallback.
   */
  async tryGetNormalizedSpanById(params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null> {
    return this.repository.tryFindNormalizedSpanById(params);
  }

  /**
   * A single span by its id, resolving ADR-022 offloaded eventref pointers when the resolution
   * dependencies were supplied. Resolution fetches the whole trace's normalized spans and isolates
   * the requested one afterwards, so sibling pointers resolve consistently with the trace read.
   */
  async tryGetSpanById(params: BySpanId & VisibilityGate): Promise<Span | null> {
    const gateOne = (span: Span | null): Span | null =>
      span ? (applyVisibilityGate([span], params.visibilityCutoffMs)[0] ?? null) : null;

    if (!this.blobResolutionDeps) {
      return gateOne(await this.repository.tryGetSpanByIds(params));
    }

    // Resolve the single span via the normalized+resolve path.
    const normalizedSpans = await this.repository.getNormalizedSpansByTraceId(params);
    const { resolvedSpans } = await TraceOffloadResolutionService.resolveOffloadedTraces({
      projectId: params.tenantId,
      normalizedSpans,
      blobStore: this.blobResolutionDeps.blobStore,
      ioExtractionService: this.blobResolutionDeps.ioExtractionService,
      logger: this.logger,
    });
    const resolved = resolvedSpans.find((s) => s.spanId === params.spanId);
    if (!resolved) {
      return null;
    }

    return gateOne(TraceLegacySpanMappingService.mapNormalizedSpanToSpan(resolved));
  }

  async getTraceEventsByTraceId(params: ByTraceId): Promise<DerivedTraceEvent[]> {
    return this.repository.getTraceEventsByTraceId(params);
  }

  /**
   * Event rollups for the trace list's Events column, one query per page. Names and counts only,
   * so unlike the per-trace detail read there is no captured content to gate: redaction blanks
   * event attributes, and this read never asks for them.
   */
  async getTraceEventRollupsByTraceIds(
    params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>> {
    return this.repository.getTraceEventRollupsByTraceIds(params);
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

  async getLangwatchSignalsByTraceId(params: ByTraceId): Promise<SpanLangwatchSignalsRow[]> {
    return this.repository.findLangwatchSignalsByTraceId(params);
  }

  async getSpanResourcesByTraceId(params: ByTraceId): Promise<SpanResourceInfo[]> {
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
