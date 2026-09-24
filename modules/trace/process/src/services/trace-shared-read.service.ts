/**
 * The anonymous share page's one read, ported from main's `sharedTrace.get`
 * (platform/app/src/server/api/routers/sharedTrace.ts:109, ADR-057).
 */
import { createHash } from "node:crypto";

import type { RateLimiter } from "@langwatch/process-stores/members";
import type { Project } from "@langwatch/project-contract";
import {
  ShareLinkNotFoundError,
  ShareReadRateLimitedError,
  type ShareApi,
  type ShareViewer,
} from "@langwatch/share-contract";
import {
  evaluationSchema,
  SHARE_MAX_FULL_SPANS,
  sharedTraceDtoSchema,
  TraceNotFoundError,
  traceSummaryDataSchema,
  type Protections,
  type SharedTraceDto,
  type SpanResourceInfo,
  type TraceApi,
  type TraceResourceInfoDto,
} from "@langwatch/trace-contract";

import {
  deriveTraceDropPrivacy,
  mapLegacySpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  redactV2Content,
  type TraceReadMapperMembers,
} from "../transport/api-trpc/trace-read-mappers.api.ts";
import {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "../transport/api-trpc/trace-view-gates.api.ts";
import type { TraceViewerProtectionService } from "./trace-viewer-protection.service.ts";

/** Main's per-window ceilings: a person refreshing never meets them; a fan-out driver does. */
const SHARE_READ_LIMIT_WINDOW_SECONDS = 60;
const SHARE_READ_LIMIT_PER_TOKEN = 60;
const SHARE_READ_LIMIT_PER_IP = 120;

const evaluationsSchema = evaluationSchema.array();

/** The trace reads the share page is assembled from — the in-app reads, not a copy of them. */
export type TraceSharedReads = Pick<
  TraceApi,
  | "readTraceSummary"
  | "readSpanSummaries"
  | "readSpans"
  | "readLangwatchSignals"
  | "readSpanResources"
  | "readTraceEvents"
  | "readEvaluations"
>;

export type TraceSharedReadDependencies = Readonly<{
  reads: TraceSharedReads;
  share: Pick<ShareApi, "resolveForViewer" | "findCachedPayload" | "cachePayload">;
  projects: Readonly<{
    findById(
      id: string,
    ): Promise<Pick<Project, "name" | "slug" | "language" | "framework" | "archivedAt"> | null>;
  }>;
  protections: Pick<TraceViewerProtectionService, "resolve">;
  rateLimiter: RateLimiter;
  mappers: TraceReadMapperMembers;
}>;

export type SharedTraceRequest = Readonly<{
  token: string;
  viewerUserId: string | null;
  clientIp: string | null;
  userAgent: string | null;
}>;

export class TraceSharedReadService {
  private constructor(private readonly deps: TraceSharedReadDependencies) {}

  static create(deps: TraceSharedReadDependencies): TraceSharedReadService {
    return new TraceSharedReadService(deps);
  }

  /**
   * Authorization re-runs on every call — the cache is read only after the token resolved and
   * the viewer's protections were computed, and is keyed by both.
   */
  async getSharedTrace(request: SharedTraceRequest): Promise<SharedTraceDto> {
    const { token } = request;
    await this.enforceReadLimit(request);

    const viewer: ShareViewer = request.viewerUserId
      ? { type: "user", id: request.viewerUserId }
      : { type: "anonymous" };
    const share = await this.deps.share.resolveForViewer({
      token,
      viewer,
      ...(request.clientIp
        ? { viewerKey: hashViewer({ clientIp: request.clientIp, userAgent: request.userAgent }) }
        : {}),
    });
    if (share.resourceType !== "TRACE") throw new ShareLinkNotFoundError();

    const projectId = share.projectId;
    const project = await this.deps.projects.findById(projectId);
    if (!project || project.archivedAt) throw new ShareLinkNotFoundError();

    const protections = await this.deps.protections.resolve({
      projectId,
      userId: request.viewerUserId ?? void 0,
      publiclyShared: true,
    });

    const cached = await this.deps.share.findCachedPayload({ token, protections });
    if (cached) {
      const revalidated = sharedTraceDtoSchema.safeParse(cached);
      if (revalidated.success) return revalidated.data;
    }

    const dto = await this.assemble({ projectId, traceId: share.resourceId, protections });
    const payload: SharedTraceDto = {
      ...dto,
      project: {
        id: projectId,
        name: project.name ?? "",
        slug: project.slug ?? "",
        language: project.language ?? "",
        framework: project.framework ?? "",
      },
    };
    await this.deps.share.cachePayload({ token, protections, payload });

    return payload;
  }

  /** Per token AND per IP: either alone lets a caller spread load around the other. */
  private async enforceReadLimit({ token, clientIp }: SharedTraceRequest): Promise<void> {
    const limit = (key: string, requests: number) =>
      this.deps.rateLimiter.check(key, { requests, seconds: SHARE_READ_LIMIT_WINDOW_SECONDS });
    const decisions = await Promise.all([
      limit(`sharedTrace:token:${token}`, SHARE_READ_LIMIT_PER_TOKEN),
      ...(clientIp ? [limit(`sharedTrace:ip:${clientIp}`, SHARE_READ_LIMIT_PER_IP)] : []),
    ]);
    if (decisions.some((decision) => !decision.allowed)) throw new ShareReadRateLimitedError();
  }

  /** The summary goes first: it locates the trace in time, so later reads prune partitions. */
  private async assemble({
    projectId,
    traceId,
    protections,
  }: {
    projectId: string;
    traceId: string;
    protections: Protections;
  }): Promise<Omit<SharedTraceDto, "project">> {
    const { reads, mappers } = this.deps;
    const visibilityCutoffMs = protections.visibilityCutoffMs ?? null;
    let summary;
    try {
      summary = traceSummaryDataSchema.parse(
        await reads.readTraceSummary({ projectId, traceId, visibilityCutoffMs }),
      );
    } catch (error) {
      if (error instanceof TraceNotFoundError) throw new ShareLinkNotFoundError();
      throw error;
    }
    const at = { projectId, traceId, occurredAtMs: summary.occurredAt };

    const [summaryRows, fullSpans, signalRows, resourceRows, eventRows, evaluationsByTrace] =
      await Promise.all([
        reads.readSpanSummaries(at),
        reads.readSpans({ ...at, visibilityCutoffMs }),
        reads.readLangwatchSignals(at),
        reads.readSpanResources(at),
        reads.readTraceEvents(at),
        reads.readEvaluations({ projectId, traceIds: [traceId], protections }),
      ]);

    const rawHeader = mapTraceSummaryToHeader(summary);
    const header = gateHeaderCost({
      header: redactV2Content(rawHeader, protections, mappers.contentPrivacy),
      protections,
    });
    header.privacy = await deriveTraceDropPrivacy(rawHeader, projectId, mappers.contentPrivacy);

    const isSpanDetailTruncated = fullSpans.length > SHARE_MAX_FULL_SPANS;

    return {
      // `langwatch.user_id` is end-user PII the share page never renders (ADR-057).
      header: { ...header, userId: null },
      spanTree: gateTreeCost({
        nodes: summaryRows.map(mapLegacySpanSummaryToTreeNode),
        protections,
      }),
      spansFull: mapSpansToDetailDtos(
        isSpanDetailTruncated ? fullSpans.slice(0, SHARE_MAX_FULL_SPANS) : fullSpans,
        protections,
        mappers,
      ),
      spanSignals: signalRows.map((row) => ({ spanId: row.spanId, signals: row.signals })),
      resources: gateResources({ resources: resourceInfoOf(resourceRows), protections }),
      events: mappers.spanProtection.applyDerivedTraceEventProtections(eventRows, protections),
      isSpanDetailTruncated,
      evaluations: gateEvaluations({
        evaluations: evaluationsSchema.parse(evaluationsByTrace[traceId] ?? []),
        protections,
      }),
    };
  }
}

/** Collapses one viewer's refreshes into one viewing; hashed, never stored or logged. */
function hashViewer({
  clientIp,
  userAgent,
}: {
  clientIp: string;
  userAgent: string | null;
}): string {
  return createHash("sha256")
    .update(`${clientIp}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

function resourceInfoOf(rows: SpanResourceInfo[]): TraceResourceInfoDto {
  const root = rows.find((row) => row.parentSpanId == null) ?? rows[0] ?? null;

  return {
    rootSpanId: root?.spanId ?? null,
    resourceAttributes: withoutHiddenResourceAttrs(root?.resourceAttributes ?? {}),
    scope: root ? { name: root.scopeName ?? "", version: root.scopeVersion } : null,
    spans: rows.map((row) => ({
      spanId: row.spanId,
      parentSpanId: row.parentSpanId,
      resourceAttributes: withoutHiddenResourceAttrs(row.resourceAttributes),
      scope: { name: row.scopeName ?? "", version: row.scopeVersion },
    })),
  };
}
