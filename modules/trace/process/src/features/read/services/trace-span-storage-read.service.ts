import { type Authorization, ownProjectIdReadBy, projectIdsReadBy } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import type {
  DerivedTraceEvent,
  NormalizedSpan,
  ElasticSearchEvent,
  Span,
  SpanResourceInfo,
  SpanSummaryRow,
  TraceEventRollup,
  SpanInsertData,
} from "@langwatch/trace-contract";

import type {
  ModelSpanSampleRow,
  ModelUsageStatsRow,
  NormalizedSpanByIdParams,
  OccurredAtHint,
  OwnedSpan,
  SpanLangwatchSignalsRow,
  SpanStorageRepository,
  StoredTraceSpan,
  TraceEventRollupParams,
  TraceViewRead,
} from "../../../repositories/span-storage.repository.ts";
import {
  braidedOwnerOf,
  readsOwnersSpans,
  singleSpanOwnerRead,
} from "../../../rules/braided-span-owner.rules.ts";
import { hasEventRefs, parseSpanEventRefs } from "../../../rules/trace-event-ref-parsing.rules.ts";
import { redactSpanContent } from "../../../rules/trace-visibility-teaser.rules.ts";
import { TraceOffloadResolutionService } from "../../../services/trace-offload-resolution.service.ts";
import type { TraceIOExtractionService } from "../../derivation/services/trace-io-extraction.service.ts";
import {
  mapNormalizedSpanToSpan,
  mapNormalizedSpansToSpans,
} from "../../legacy/rules/trace-legacy-span-mapping.rules.ts";
import type { TraceBlobStoreService } from "../../media/services/trace-blob-store.service.ts";

/**
 * Optional blob-offload resolution dependencies for the v2 read path (ADR-022). When provided, the
 * span reads resolve any `langwatch.reserved.eventref.*` pointers before mapping; when omitted the
 * service falls back to the preview values already stored, exactly as before ADR-022.
 */
interface SpanReadBlobResolutionDeps {
  blobStore: TraceBlobStoreService;
  ioExtractionService: TraceIOExtractionService;
}

/** Every read carries the sealed proof; the repository fences its statement by it (ADR-177). */
type ByTraceId = { authorization: Authorization; traceId: string } & OccurredAtHint;
/** `ownerProjectId` names a braided span's owner; absent, the reader's own (ADR-185 §5). */
type BySpanId = ByTraceId & { spanId: string; ownerProjectId?: string | undefined };
/** A trace-view read: `reads: "spans"` lets the proof's braids show owners' spans (ADR-185 §5). */
type ByTraceView = ByTraceId & TraceViewRead;
type Paginated = ByTraceView & { limit: number; offset: number };
/** Full-span delta: keyed on span start (see `findSpansSince`). */
type Since = ByTraceView & { sinceStartTimeMs: number };
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
    span.timestamps.started_at < visibilityCutoffMs ? redactSpanContent(span) : span,
  );
};

/** A span with its reserved eventref pointers dropped and its previews kept. */
const withoutEventRefs = (span: NormalizedSpan): NormalizedSpan =>
  hasEventRefs(span.spanAttributes)
    ? { ...span, spanAttributes: parseSpanEventRefs(span.spanAttributes).cleanedAttrs }
    : span;

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
    params: ByTraceView & { limit?: number } & VisibilityGate,
  ): Promise<OwnedSpan[]> {
    if (!this.blobResolutionDeps) {
      return applyVisibilityGate(
        await this.repository.findSpansByTraceId(params),
        params.visibilityCutoffMs,
      );
    }

    // Fetch normalized spans so resolution can access raw spanAttributes.
    const normalizedSpans = await this.repository.findNormalizedSpansByTraceId(params);
    if (readsOwnersSpans(params)) {
      const resolved = await this.resolveBodiesByOwner({
        normalizedSpans,
        deps: this.blobResolutionDeps,
      });
      const owned = resolved.map((span) => ({
        ...mapNormalizedSpanToSpan(span),
        ...braidedOwnerOf({ authorization: params.authorization, tenantId: span.tenantId }),
      }));
      // The cutoff is the organisation's plan, and a braid joins projects of one organisation.
      return applyVisibilityGate(owned, params.visibilityCutoffMs);
    }
    const resolvedSpans = await this.resolveOffloadedBodies({
      authorization: params.authorization,
      normalizedSpans,
      deps: this.blobResolutionDeps,
    });

    return applyVisibilityGate(mapNormalizedSpansToSpans(resolvedSpans), params.visibilityCutoffMs);
  }

  /** A braided read's bodies, each resolved under the project that stored it (ADR-185 §5). */
  private async resolveBodiesByOwner({
    normalizedSpans,
    deps,
  }: {
    normalizedSpans: NormalizedSpan[];
    deps: SpanReadBlobResolutionDeps;
  }): Promise<NormalizedSpan[]> {
    const resolved: NormalizedSpan[] = [...normalizedSpans];
    const owners = [...new Set(normalizedSpans.map((span) => span.tenantId))];
    for (const projectId of owners) {
      const indexes = normalizedSpans.flatMap((span, index) =>
        span.tenantId === projectId ? [index] : [],
      );
      const { resolvedSpans } = await TraceOffloadResolutionService.create().resolveOffloadedTraces(
        {
          projectId,
          normalizedSpans: indexes.map((index) => normalizedSpans[index]!),
          blobStore: deps.blobStore,
          ioExtractionService: deps.ioExtractionService,
          logger: this.logger,
        },
      );
      indexes.forEach((index, position) => {
        resolved[index] = resolvedSpans[position] ?? withoutEventRefs(normalizedSpans[index]!);
      });
    }
    return resolved;
  }

  async getNormalizedSpansByTraceId(
    params: ByTraceId & { limit?: number },
  ): Promise<NormalizedSpan[]> {
    return this.repository.findNormalizedSpansByTraceId(params);
  }

  /** A trace's spans with their attributes as stored, unparsed, for a reader that hands them on. */
  async findStoredSpansByTraceId(
    params: ByTraceId & { limit?: number },
  ): Promise<StoredTraceSpan[]> {
    return this.repository.findStoredSpansByTraceId(params);
  }

  /**
   * Claim-check resolution read (ADR-069): one canonical span by identity for internal derivation
   * consumers. Deliberately ungated and unresolved, and `null` means not readable yet so queue
   * callers retry. The partition hint is required: the read behind it has no unbounded fallback.
   */
  async findNormalizedSpanById(params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null> {
    return this.repository.findNormalizedSpanById(params);
  }

  /**
   * A single span by its id, resolving ADR-022 offloaded eventref pointers when the resolution
   * dependencies were supplied. Resolution fetches the whole trace's normalized spans and isolates
   * the requested one afterwards, so sibling pointers resolve consistently with the trace read.
   */
  async findSpanById(params: BySpanId & VisibilityGate): Promise<Span | null> {
    const gateOne = (span: Span | null): Span | null =>
      span ? (applyVisibilityGate([span], params.visibilityCutoffMs)[0] ?? null) : null;
    const ownerRead = singleSpanOwnerRead(params);
    if (ownerRead.kind === "unreadable") return null;
    if (
      ownerRead.kind === "braided" &&
      ownerRead.ownerProjectId !== ownProjectIdReadBy(params.authorization)
    ) {
      return gateOne(await this.findBraidedSpan({ ...params, ...ownerRead }));
    }

    if (!this.blobResolutionDeps) {
      return gateOne(await this.repository.findSpanByIds(params));
    }

    // Resolve the single span via the normalized+resolve path.
    const normalizedSpans = await this.repository.findNormalizedSpansByTraceId(params);
    const resolvedSpans = await this.resolveOffloadedBodies({
      authorization: params.authorization,
      normalizedSpans,
      deps: this.blobResolutionDeps,
    });
    const resolved = resolvedSpans.find((s) => s.spanId === params.spanId);
    if (!resolved) {
      return null;
    }

    return gateOne(mapNormalizedSpanToSpan(resolved));
  }

  /** A braided span read alone, its offloaded body resolved where its owner stored it. */
  private async findBraidedSpan(
    params: BySpanId & { ownerProjectId: string },
  ): Promise<Span | null> {
    const deps = this.blobResolutionDeps;
    if (!deps) return this.repository.findSpanByIds(params);
    const normalized = await this.repository.findNormalizedSpanByIds(params);
    if (normalized === null) return null;
    const { resolvedSpans } = await TraceOffloadResolutionService.create().resolveOffloadedTraces({
      projectId: params.ownerProjectId,
      normalizedSpans: [normalized],
      blobStore: deps.blobStore,
      ioExtractionService: deps.ioExtractionService,
      logger: this.logger,
    });
    const [resolved] = resolvedSpans;
    return resolved === undefined ? null : mapNormalizedSpanToSpan(resolved);
  }

  /**
   * Restores offloaded span bodies (ADR-022), which live outside ClickHouse under one project id:
   * read only when the proof reads exactly one project. While it spans an aggregate's members each
   * span keeps its preview and its reserved pointers are dropped (ADR-177).
   */
  private async resolveOffloadedBodies({
    authorization,
    normalizedSpans,
    deps,
  }: {
    authorization: Authorization;
    normalizedSpans: NormalizedSpan[];
    deps: SpanReadBlobResolutionDeps;
  }): Promise<NormalizedSpan[]> {
    const [projectId, ...others] = projectIdsReadBy(authorization);
    if (projectId === undefined || others.length > 0) {
      return normalizedSpans.map(withoutEventRefs);
    }
    const { resolvedSpans } = await TraceOffloadResolutionService.create().resolveOffloadedTraces({
      projectId,
      normalizedSpans,
      blobStore: deps.blobStore,
      ioExtractionService: deps.ioExtractionService,
      logger: this.logger,
    });

    return resolvedSpans;
  }

  async getTraceEventsByTraceId(params: ByTraceView): Promise<DerivedTraceEvent[]> {
    return this.repository.findTraceEventsByTraceId(params);
  }

  /**
   * Event rollups for the trace list's Events column, one query per page. Names and counts only,
   * so unlike the per-trace detail read there is no captured content to gate: redaction blanks
   * event attributes, and this read never asks for them.
   */
  async getTraceEventRollupsByTraceIds(
    params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>> {
    return this.repository.findTraceEventRollupsByTraceIds(params);
  }

  async getEventsByTraceId(params: ByTraceId): Promise<ElasticSearchEvent[]> {
    return this.repository.findEventsByTraceId(params);
  }

  async getSpanEvents(params: BySpanId): Promise<ElasticSearchEvent[]> {
    return this.repository.findSpanEvents(params);
  }

  async getSpanSummaryByTraceId(params: ByTraceView): Promise<SpanSummaryRow[]> {
    return this.repository.findSpanSummaryByTraceId(params);
  }

  async getLangwatchSignalsByTraceId(params: ByTraceView): Promise<SpanLangwatchSignalsRow[]> {
    return this.repository.findLangwatchSignalsByTraceId(params);
  }

  async getSpanResourcesByTraceId(params: ByTraceView): Promise<SpanResourceInfo[]> {
    return this.repository.findSpanResourcesByTraceId(params);
  }

  async getSpansPaginated(
    params: Paginated & VisibilityGate,
  ): Promise<{ spans: OwnedSpan[]; total: number }> {
    const page = await this.repository.listSpansPaginated(params);

    return {
      ...page,
      spans: applyVisibilityGate(page.spans, params.visibilityCutoffMs),
    };
  }

  async getSpansSince(params: Since & VisibilityGate): Promise<OwnedSpan[]> {
    return applyVisibilityGate(
      await this.repository.findSpansSince(params),
      params.visibilityCutoffMs,
    );
  }

  async getModelUsageStats(params: {
    authorization: Authorization;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return this.repository.findModelUsageStats(params);
  }

  async getRecentSpansByModels(params: {
    authorization: Authorization;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return this.repository.findRecentSpansByModels(params);
  }
}
