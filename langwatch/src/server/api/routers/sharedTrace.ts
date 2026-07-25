import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { z } from "zod";

import { getApp } from "~/server/app-layer/app";
import {
  ShareLinkNotFoundError,
  ShareReadRateLimitedError,
} from "~/server/app-layer/share/errors";
import type { ShareViewer } from "~/server/app-layer/share/share.service";
import { buildSharedTraceCacheKey } from "~/server/app-layer/share/shared-trace-cache.service";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";
import { TraceNotFoundError } from "~/server/app-layer/traces/errors";
import { applyDerivedTraceEventProtections } from "~/server/traces/mappers/redaction";
import type { Protections } from "~/server/traces/protections";
import { TraceService } from "~/server/traces/trace.service";

import {
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  skipPermissionCheck,
} from "../rbac";
import { getUserProtectionsForProject } from "../utils";
import {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateTreeCost,
} from "./tracesV2.gates";
import { withoutHiddenResourceAttrs } from "./tracesV2.resourceAttrs";
import {
  deriveTraceDropPrivacy,
  mapSpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  redactV2Content,
} from "./tracesV2";
import {
  SHARE_MAX_FULL_SPANS,
  sharedTraceDtoSchema,
} from "./sharedTrace.schemas";
import type { SharedTraceDto } from "./sharedTrace.schemas";
import type { TraceResourceInfoDto } from "./tracesV2.schemas";

/**
 * The single public surface for anonymous shared-trace reads.
 *
 * ONE token-validated call returns EVERYTHING the read-only share page needs,
 * as an explicit share-safe DTO. Because it is the only public trace read,
 * authorization happens exactly once (here). All the internal `tracesV2.*` /
 * `traces.*` / `annotation.*` reads stay `protectedProcedure`. See ADR-057.
 *
 * A field can only reach a share viewer if it is deliberately named in
 * `sharedTrace.schemas.ts`, which builds the payload shape as an explicit
 * `.pick()` from each internal read schema and is applied below as the
 * procedure's `.output()` parser. tRPC runs that parser server-side and Zod
 * strips keys the schema does not name, so a new column on an internal read is
 * dropped at the share boundary rather than silently published — the guarantee
 * holds at runtime, not by convention.
 */

/**
 * Per-window ceilings for the anonymous read. Generous enough that a person
 * reading a shared trace — including refreshes and a second tab — never meets
 * them, tight enough that the endpoint is not a cheap way to drive repeated
 * ClickHouse fan-out from outside.
 */
const SHARE_READ_LIMIT_WINDOW_SECONDS = 60;
const SHARE_READ_LIMIT_PER_TOKEN = 60;
const SHARE_READ_LIMIT_PER_IP = 120;

async function enforceShareReadLimit({
  token,
  clientIp,
}: {
  token: string;
  clientIp: string | undefined;
}): Promise<void> {
  const checks = [
    rateLimit({
      key: `sharedTrace:token:${token}`,
      windowSeconds: SHARE_READ_LIMIT_WINDOW_SECONDS,
      max: SHARE_READ_LIMIT_PER_TOKEN,
    }),
    ...(clientIp
      ? [
          rateLimit({
            key: `sharedTrace:ip:${clientIp}`,
            windowSeconds: SHARE_READ_LIMIT_WINDOW_SECONDS,
            max: SHARE_READ_LIMIT_PER_IP,
          }),
        ]
      : []),
  ];

  const results = await Promise.all(checks);
  if (results.some((result) => !result.allowed)) {
    throw new ShareReadRateLimitedError();
  }
}

export const sharedTraceRouter = createTRPCRouter({
  /**
   * Resolve a share token and return the complete read-only trace payload.
   * Every resolve consumes one view and enforces expiry, view cap, audience
   * and the sharing kill switch — all in `resolveForViewer`. A page load still
   * counts once because every client caller shares this query's React Query
   * key, deduping onto a single request.
   */
  get: publicProcedure
    .input(z.object({ token: z.string() }))
    // `.output()` comes after `.use()`: the app's permission builder exposes
    // only `input`/`use` so every procedure is forced through the permission
    // middleware, and it is that `use` which hands back the full tRPC builder.
    .use(skipPermissionCheck)
    .output(sharedTraceDtoSchema)
    .query(async ({ input, ctx }) => {
      const viewer: ShareViewer = {
        isOrgMember: async (organizationId) =>
          !!ctx.session?.user &&
          hasOrganizationPermission(
            { prisma: ctx.prisma, session: ctx.session },
            organizationId,
            "organization:view",
          ),
        isProjectMember: async (projectId) =>
          hasProjectPermission(
            { prisma: ctx.prisma, session: ctx.session },
            projectId,
            "traces:view",
          ),
      };

      // This is the one trace read the open internet can drive, and each call
      // costs five ClickHouse reads plus a view write. Limit per token AND per
      // IP: per-token alone lets one host spread load across many leaked
      // tokens, per-IP alone lets a distributed caller hammer a single link.
      const clientIp = getClientIp(ctx.req);
      await enforceShareReadLimit({ token: input.token, clientIp });

      // Identifies one viewer well enough to collapse their refreshes into a
      // single viewing. Hashed and held only for the dedupe window, never
      // stored or logged; absent when we cannot see an IP, in which case every
      // request counts as a viewing (the stricter behaviour).
      const viewerKey = clientIp
        ? createHash("sha256")
            .update(`${clientIp}|${ctx.req?.headers?.["user-agent"] ?? ""}`)
            .digest("hex")
            .slice(0, 32)
        : undefined;

      // Throws typed share HandledErrors on any failure — handledErrorMiddleware
      // maps them to wire codes (not_found/kill-switch → 404, expired and
      // exhausted → 403, out-of-audience → 401).
      const share = await getApp().share.resolveForViewer({
        token: input.token,
        viewer,
        viewerKey,
      });

      if (share.resourceType !== "TRACE") {
        // The read-only viewer only renders traces; a THREAD-typed share has no
        // renderable payload here.
        throw new ShareLinkNotFoundError();
      }

      const projectId = share.projectId;
      const traceId = share.resourceId;

      // Share viewers read with the project's protections computed for the
      // presented session: captured content follows the data-privacy policy and
      // the plan visibility cutoff, and restricted resource/event attributes are
      // stripped. Cost visibility follows the viewer's OWN `cost:view`
      // permission (an anonymous viewer sees none), so a signed-in member
      // resolving an org/project-scoped link may see spend — sharing never
      // widens what a viewer could already see in-app. See ADR-057.
      //
      // A missing or archived project resolves like a bad token (generic
      // NOT_FOUND) rather than surfacing a raw Prisma error — the protections
      // lookup does a findUniqueOrThrow on the project.
      let protections: Protections;
      try {
        protections = await getUserProtectionsForProject(
          { prisma: ctx.prisma, session: ctx.session, publiclyShared: true },
          { projectId },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw new ShareLinkNotFoundError();
        }
        throw error;
      }

      const app = getApp();

      // Cache lookup happens AFTER the token resolved and protections were
      // computed — never before. Authorization is re-run on every request, so
      // a revoked, expired or exhausted link stops serving immediately no
      // matter what is cached, and the key carries a protections fingerprint
      // so two viewers with different redactions can never share an entry.
      const cacheKey = buildSharedTraceCacheKey({
        token: input.token,
        protections,
      });
      const cached = await app.sharedTraceCache.get(cacheKey);
      if (cached) {
        // Re-parsed through the same output schema rather than trusted: a
        // stale entry written by an older deploy is stripped to today's share
        // contract instead of replaying a field since removed from it.
        const revalidated = sharedTraceDtoSchema.safeParse(cached);
        if (revalidated.success) return revalidated.data;
      }

      // The summary is fetched first: it locates the trace in time, so every
      // remaining ClickHouse read carries an OccurredAt hint and prunes to the
      // trace's partitions instead of scanning cold storage — this endpoint is
      // unauthenticated, so an unhinted scan would be an easy resource sink.
      // A share whose trace no longer exists (retention, deletion) resolves to
      // the same generic NOT_FOUND as a bad token.
      let summary;
      try {
        summary = await app.traces.summary.getByTraceId(projectId, traceId, {
          visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
        });
      } catch (error) {
        if (TraceNotFoundError.is(error)) throw new ShareLinkNotFoundError();
        throw error;
      }
      const occurredAtHint = { occurredAtMs: summary.occurredAt };

      const [
        project,
        summaryRows,
        fullSpans,
        signalRows,
        resourceRows,
        eventRows,
        evaluationsByTrace,
      ] = await Promise.all([
        app.projects.getById(projectId),
        app.traces.spans.getSpanSummaryByTraceId({
          tenantId: projectId,
          traceId,
          ...occurredAtHint,
        }),
        app.traces.spans.getSpansByTraceId({
          tenantId: projectId,
          traceId,
          visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
          ...occurredAtHint,
        }),
        app.traces.spans.getLangwatchSignalsByTraceId({
          tenantId: projectId,
          traceId,
          ...occurredAtHint,
        }),
        app.traces.spans.getSpanResourcesByTraceId({
          tenantId: projectId,
          traceId,
          ...occurredAtHint,
        }),
        app.traces.spans.getTraceEventsByTraceId({
          tenantId: projectId,
          traceId,
          ...occurredAtHint,
        }),
        TraceService.create(ctx.prisma).getEvaluationsMultiple(
          projectId,
          [traceId],
          protections,
        ),
      ]);

      // Header (spend stripped; the DROP banner derives exactly as the
      // internal `tracesV2.header` read derives it, so a drop-policy trace
      // explains its missing content on the share page too).
      const rawHeader = mapTraceSummaryToHeader(summary);
      const header = gateHeaderCost({
        header: redactV2Content(rawHeader, protections),
        protections,
      });
      header.privacy = await deriveTraceDropPrivacy(rawHeader, projectId);

      // Span waterfall (spend stripped).
      const spanTree = gateTreeCost({
        nodes: summaryRows.map(mapSpanSummaryToTreeNode),
        protections,
      });

      // Full span detail — the SAME pipeline as the internal
      // `tracesV2.spansFull` read (span protections, content + spend
      // redaction, privacy annotations), shared so the anonymous surface can
      // never drift behind an in-app redaction.
      //
      // Capped: this endpoint is unauthenticated, and a wide agent trace would
      // otherwise assemble every span's input/output into one unbounded
      // response. The waterfall stays complete; only per-span detail stops,
      // and the payload says so rather than rendering an empty detail pane.
      const isSpanDetailTruncated = fullSpans.length > SHARE_MAX_FULL_SPANS;
      const spansFull = mapSpansToDetailDtos(
        isSpanDetailTruncated
          ? fullSpans.slice(0, SHARE_MAX_FULL_SPANS)
          : fullSpans,
        protections,
      );

      const resources: TraceResourceInfoDto = gateResources({
        resources: buildResourceInfo(resourceRows),
        protections,
      });

      const evaluations = gateEvaluations({
        evaluations: evaluationsByTrace[traceId] ?? [],
        protections,
      });

      const dto: SharedTraceDto = {
        project: {
          id: projectId,
          name: project?.name ?? "",
          slug: project?.slug ?? "",
          language: project?.language ?? "",
          framework: project?.framework ?? "",
        },
        // `langwatch.user_id` identifies the end user behind the trace — PII
        // that reaches the payload only via the header. The read-only share
        // viewer never renders it and sharing must not disclose it, so it is
        // nulled here AND pinned to `z.null()` on the output schema, which
        // turns a future regression into a parse failure rather than a quiet
        // leak. It is not gated by cost/content protections. See ADR-057.
        header: { ...header, userId: null },
        spanTree,
        spansFull,
        spanSignals: signalRows.map((row) => ({
          spanId: row.spanId,
          signals: row.signals,
        })),
        resources,
        events: applyDerivedTraceEventProtections(eventRows, protections),
        isSpanDetailTruncated,
        evaluations,
      };
      // Best-effort: a cache write failure is logged, never fatal to the read.
      await app.sharedTraceCache.set(cacheKey, dto);
      return dto;
    }),
});

/** Build the resource-info DTO from raw per-span resource rows. */
function buildResourceInfo(
  rows: Array<{
    spanId: string;
    parentSpanId: string | null;
    resourceAttributes: Record<string, string>;
    scopeName: string | null;
    scopeVersion: string | null;
  }>,
): TraceResourceInfoDto {
  const spans = rows.map((r) => ({
    spanId: r.spanId,
    parentSpanId: r.parentSpanId,
    resourceAttributes: withoutHiddenResourceAttrs(r.resourceAttributes),
    scope: { name: r.scopeName ?? "", version: r.scopeVersion },
  }));
  const root = rows.find((r) => r.parentSpanId == null) ?? rows[0] ?? null;
  return {
    rootSpanId: root?.spanId ?? null,
    resourceAttributes: withoutHiddenResourceAttrs(root?.resourceAttributes ?? {}),
    scope: root
      ? { name: root.scopeName ?? "", version: root.scopeVersion }
      : null,
    spans,
  };
}
