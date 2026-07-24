import { createLogger } from "@langwatch/observability";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import { mapNormalizedSpanToSpan } from "~/server/traces/mappers/span.mapper";
import {
  hasEventRefs,
  parseSpanEventRefs,
} from "~/server/traces/offloaded-eventref-parsing";
import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import type { BlobStore } from "./blob-store.service";
import type {
  ModelSpanSampleRow,
  ModelUsageStatsRow,
  OccurredAtHint,
  SpanLangwatchSignalsRow,
  SpanResourceInfo,
  SpanStorageRepository,
  SpanSummaryPage,
  SpanSummaryPageCursor,
  SpanSummaryRow,
} from "./repositories/span-storage.repository";
import type { TraceIOExtractionService } from "./trace-io-extraction.service";
import type { SpanInsertData } from "./types";
import { redactSpanContent } from "./visibility-window.service";

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
/** Full-span delta: keyed on span start (see `findSpansSince`). */
type Since = ByTraceId & { sinceStartTimeMs: number };
/**
 * Span-summary delta: keyed on the ROW VERSION, so spans updated in place
 * (end time, duration, status, cost) are picked up too — a start-keyed poll
 * only ever sees brand-new spans.
 */
type SinceUpdated = ByTraceId & { sinceUpdatedAtMs: number };

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

/**
 * Read-path completeness check for one span's offloaded attributes (#5835).
 *
 * Given a span's PRE-resolution attributes and the attributes it holds AFTER
 * {@link resolveOffloadedTraces} ran, returns true when at least one
 * `langwatch.reserved.eventref.*` pointer did NOT get replaced with its full
 * value — the resolved value is still the write-time preview, so the span is
 * showing truncated content. Mirrors the summary/list path's
 * `detectOffloadedIOFields`: a ref carrying no usable eventId, or whose value
 * failed to parse, can never resolve and likewise counts as incomplete.
 */
export function spanHasIncompleteAttributes(
  preResolutionAttrs: Record<string, string>,
  resolvedAttrs: Record<string, string>,
): boolean {
  if (!hasEventRefs(preResolutionAttrs)) return false;
  const { cleanedAttrs, eventrefEntries, missingEventIdKeys, malformedKeys } =
    parseSpanEventRefs(preResolutionAttrs);
  // A ref with no usable eventId — or whose value is not valid JSON — can never
  // resolve, so its value stays the write-time preview (#5835 AC4b).
  if (missingEventIdKeys.length > 0 || malformedKeys.length > 0) return true;
  // A well-formed ref is unresolved when its resolved value still equals the
  // write-time preview (a successful resolution overwrote it with the full value).
  return eventrefEntries.some(
    ({ attrKey }) => resolvedAttrs[attrKey] === cleanedAttrs[attrKey],
  );
}

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
      this.mapResolvedSpansWithIncompleteFlag(normalizedSpans, resolvedSpans),
      params.visibilityCutoffMs,
    );
  }

  /**
   * Maps resolved spans to the legacy Span shape and flags each span whose
   * offloaded attributes could not be fully resolved (#5835). Pre-resolution
   * attributes are paired to their resolved span by spanId, so the flag is
   * independent of any ordering assumption in {@link resolveOffloadedTraces}.
   */
  private mapResolvedSpansWithIncompleteFlag(
    preResolutionSpans: NormalizedSpan[],
    resolvedSpans: NormalizedSpan[],
  ): Span[] {
    const preAttrsBySpanId = new Map(
      preResolutionSpans.map((s) => [
        s.spanId,
        s.spanAttributes as Record<string, string>,
      ]),
    );
    return resolvedSpans.map((resolved) => {
      const mapped = mapNormalizedSpanToSpan(resolved);
      const preAttrs = preAttrsBySpanId.get(resolved.spanId);
      return preAttrs &&
        spanHasIncompleteAttributes(
          preAttrs,
          resolved.spanAttributes as Record<string, string>,
        )
        ? { ...mapped, hasIncompleteAttributes: true }
        : mapped;
    });
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
    const preSpan = normalizedSpans.find((s) => s.spanId === params.spanId);
    const mapped = mapNormalizedSpanToSpan(resolved);
    return gateOne(
      preSpan &&
        spanHasIncompleteAttributes(
          preSpan.spanAttributes as Record<string, string>,
          resolved.spanAttributes as Record<string, string>,
        )
        ? { ...mapped, hasIncompleteAttributes: true }
        : mapped,
    );
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

  async getSpanSummariesPage(
    params: ByTraceId & { limit: number; cursor?: SpanSummaryPageCursor },
  ): Promise<SpanSummaryPage> {
    return this.repository.findSpanSummariesPage(params);
  }

  async getSpanSummariesSince(
    params: SinceUpdated,
  ): Promise<SpanSummaryRow[]> {
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
