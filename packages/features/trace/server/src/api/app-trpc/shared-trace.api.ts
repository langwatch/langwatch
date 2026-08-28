/**
 * The single public surface for anonymous shared-trace reads.
 *
 * ONE token-validated call returns EVERYTHING the read-only share page needs,
 * as an explicit share-safe DTO. Because it is the only public trace read,
 * authorization happens exactly once (here). All the internal `tracesV2.*` /
 * `traces.*` / `annotation.*` reads stay authenticated. See ADR-057.
 *
 * A field can only reach a share viewer if it is deliberately named in
 * `trace-share.schemas.ts`, which builds the payload shape as an explicit
 * `.pick()` from each internal read schema and is applied below as the
 * procedure's `.output()` parser. tRPC runs that parser server-side and Zod
 * strips keys the schema does not name, so a new column on an internal read is
 * dropped at the share boundary rather than silently published — the guarantee
 * holds at runtime, not by convention.
 *
 * This router is deliberately its own surface rather than a procedure on
 * `tracesV2`: it is the ONE place a request with no session gets a trace back,
 * and keeping it separate is what makes that reviewable.
 */
import { createHash } from "node:crypto";
import {
  ShareLinkNotFoundError,
  ShareReadRateLimitedError,
  type ShareViewer,
} from "@langwatch/share-contract";
import {
  sharedTraceDtoSchema,
  SHARE_MAX_FULL_SPANS,
  type Evaluation,
  type SharedTraceDto,
  type TraceResourceInfoDto,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { Protections } from "../../services/trace-viewer-protections.service";
import {
  deriveTraceDropPrivacy,
  mapLegacySpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  redactV2Content,
  type TraceReadMapperPorts,
} from "./trace-read-mappers.api";
import {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "./trace-view-gates.api";
import type { TracesV2SpanReader } from "./traces-v2.api";

/**
 * Per-window ceilings for the anonymous read. Generous enough that a person
 * reading a shared trace — including refreshes and a second tab — never meets
 * them, tight enough that the endpoint is not a cheap way to drive repeated
 * ClickHouse fan-out from outside.
 */
const SHARE_READ_LIMIT_WINDOW_SECONDS = 60;
const SHARE_READ_LIMIT_PER_TOKEN = 60;
const SHARE_READ_LIMIT_PER_IP = 120;

/** The resolved share, as far as this read needs to know it. */
type ResolvedShare = Readonly<{
  resourceType: string;
  projectId: string;
  resourceId: string;
}>;

type SharedTraceApplication = Readonly<{
  share: Readonly<{
    resolveForViewer(input: {
      token: string;
      viewer: ShareViewer;
      viewerKey?: string;
    }): Promise<ResolvedShare>;
    tryGetCachedPayload(input: { token: string; protections: Protections }): Promise<unknown>;
    cachePayload(input: {
      token: string;
      protections: Protections;
      payload: SharedTraceDto;
    }): Promise<void>;
  }>;
  projects: Readonly<{
    tryGetById(projectId: string): Promise<{
      name: string | null;
      slug: string | null;
      language: string | null;
      framework: string | null;
    } | null>;
  }>;
  traces: Readonly<{
    summary: Readonly<{
      getByTraceId(
        tenantId: string,
        traceId: string,
        options?: { visibilityCutoffMs?: number | null },
      ): Promise<TraceSummaryData>;
    }>;
    spans: TracesV2SpanReader;
    read: Readonly<{
      getEvaluationsMultiple(
        projectId: string,
        traceIds: string[],
        protections: Protections,
      ): Promise<Record<string, Evaluation[]>>;
    }>;
  }>;
}>;

/**
 * The process supplies the request, the session (when there is one) and the
 * application. There is no authenticated actor here by design.
 */
export type SharedTraceTrpcContext = Readonly<{
  app: SharedTraceApplication;
  session: { user?: { id: string } } | null | undefined;
  req?: { headers?: Record<string, unknown> } | undefined;
}>;

type SharedTraceTrpcProcedures<
  TContext extends SharedTraceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's PUBLIC procedure — no session required. */
  public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's declared "no permission to check" policy, applied AFTER this
   * feature's own input parser. The share token in that input IS the whole
   * authorization; the declaration is what keeps the procedure reviewable
   * rather than merely unchecked.
   */
  noPermission(declaration: { reason: string }): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs that Trace does not own. */
export type SharedTraceTrpcPorts = Readonly<{
  /** The mapping and redaction ports the shared read mappers take. */
  mappers: TraceReadMapperPorts;
  /**
   * The caller's read-time redactions for the share's project, computed for
   * the presented session with `publiclyShared` set. Resolves to null when the
   * project is missing or archived, which the caller turns into the same
   * generic not-found a bad token gets.
   */
  tryGetShareViewerProtections(input: {
    projectId: string;
    session: { user?: { id: string } } | null | undefined;
  }): Promise<Protections | null>;
  /** The process's fixed-window rate limiter. */
  rateLimit(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean }>;
  /** The request's client IP, as the process resolves it behind its proxies. */
  getClientIp(req: unknown): string | undefined;
  /** True when the read's trace no longer exists. */
  isTraceNotFound(error: unknown): boolean;
}>;

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
    scope: root ? { name: root.scopeName ?? "", version: root.scopeVersion } : null,
    spans,
  };
}

async function enforceShareReadLimit({
  token,
  clientIp,
  rateLimit,
}: {
  token: string;
  clientIp: string | undefined;
  rateLimit: SharedTraceTrpcPorts["rateLimit"];
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

/** Installs the complete `sharedTrace.*` tRPC surface on a process-owned root. */
export class SharedTraceTrpcApi {
  static create<
    TContext extends SharedTraceTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SharedTraceTrpcProcedures<TContext, TOptions, TRoot>,
    ports: SharedTraceTrpcPorts,
  ) {
    const { public: procedure, noPermission } = procedures;

    return trpc.router({
      /**
       * Resolve a share token and return the complete read-only trace payload.
       * Every resolve consumes one view and enforces expiry, view cap, audience
       * and the sharing kill switch — all in `resolveForViewer`. A page load still
       * counts once because every client caller shares this query's React Query
       * key, deduping onto a single request.
       */
      get: noPermission({
        reason: "the share token in the input is the whole authorization; see ADR-057",
      })(procedure.input(z.object({ token: z.string() })))
        // `.output()` comes after the policy: the app's permission builder
        // exposes only `input`/`use` so every procedure is forced through the
        // permission middleware, and it is that `use` which hands back the
        // full tRPC builder.
        .output(sharedTraceDtoSchema)
        .query(async ({ input, ctx }) => {
          const viewer: ShareViewer = ctx.session?.user
            ? { type: "user", id: ctx.session.user.id }
            : { type: "anonymous" };

          // This is the one trace read the open internet can drive, and each call
          // costs five ClickHouse reads plus a view write. Limit per token AND per
          // IP: per-token alone lets one host spread load across many leaked
          // tokens, per-IP alone lets a distributed caller hammer a single link.
          const clientIp = ports.getClientIp(ctx.req);
          await enforceShareReadLimit({
            token: input.token,
            clientIp,
            rateLimit: ports.rateLimit,
          });

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
          const share = await ctx.app.share.resolveForViewer({
            token: input.token,
            viewer,
            ...(viewerKey !== undefined ? { viewerKey } : {}),
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
          // NOT_FOUND) rather than surfacing a raw database error.
          const protections = await ports.tryGetShareViewerProtections({
            projectId,
            session: ctx.session,
          });
          if (!protections) throw new ShareLinkNotFoundError();

          const app = ctx.app;

          // Cache lookup happens AFTER the token resolved and protections were
          // computed — never before. Authorization is re-run on every request, so
          // a revoked, expired or exhausted link stops serving immediately no
          // matter what is cached, and the key carries a protections fingerprint
          // so two viewers with different redactions can never share an entry.
          const cached = await app.share.tryGetCachedPayload({
            token: input.token,
            protections,
          });
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
            if (ports.isTraceNotFound(error)) throw new ShareLinkNotFoundError();
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
            app.projects.tryGetById(projectId),
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
            app.traces.read.getEvaluationsMultiple(projectId, [traceId], protections),
          ]);

          // Header (spend stripped; the DROP banner derives exactly as the
          // internal `tracesV2.header` read derives it, so a drop-policy trace
          // explains its missing content on the share page too).
          const rawHeader = mapTraceSummaryToHeader(summary);
          const header = gateHeaderCost({
            header: redactV2Content(rawHeader, protections, ports.mappers.contentPrivacy),
            protections,
          });
          header.privacy = await deriveTraceDropPrivacy(
            rawHeader,
            projectId,
            ports.mappers.contentPrivacy,
          );

          // Span waterfall (spend stripped).
          const spanTree = gateTreeCost({
            nodes: summaryRows.map(mapLegacySpanSummaryToTreeNode),
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
            isSpanDetailTruncated ? fullSpans.slice(0, SHARE_MAX_FULL_SPANS) : fullSpans,
            protections,
            ports.mappers,
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
            events: ports.mappers.spanProtection.applyDerivedTraceEventProtections(
              eventRows,
              protections,
            ),
            isSpanDetailTruncated,
            evaluations,
          };
          // Best-effort: a cache write failure is logged, never fatal to the read.
          await app.share.cachePayload({
            token: input.token,
            protections,
            payload: dto,
          });
          return dto;
        }),
    });
  }
}
