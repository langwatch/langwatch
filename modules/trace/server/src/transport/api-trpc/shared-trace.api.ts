import type { Protections } from "@langwatch/trace-contract";
/**
 * The single public surface for anonymous shared-trace reads (ADR-057). One token-validated
 * call returns everything the share page needs as an explicit share-safe DTO — a field only
 * reaches a share viewer if it's named in `trace-share.schemas.ts`'s `.pick()`, applied as this
 * procedure's `.output()` parser, so Zod strips unnamed keys at runtime. Kept as its own router,
 * not a procedure on `tracesV2`, since it's the one place a request with no session gets a trace.
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
  type SharedTraceDto,
  type TraceResourceInfoDto,
} from "@langwatch/trace-contract";
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

import {
  deriveTraceDropPrivacy,
  mapLegacySpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  redactV2Content,
  type TraceReadMapperPorts,
} from "./trace-read-mappers.api.ts";
import {
  gateEvaluations,
  gateHeaderCost,
  gateResources,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "./trace-view-gates.api.ts";
import type { TraceApp } from "#app/trace.app";

/**
 * Per-window ceilings for the anonymous read. Generous enough that a person
 * reading a shared trace — including refreshes and a second tab — never meets
 * them, tight enough that the endpoint is not a cheap way to drive repeated
 * ClickHouse fan-out from outside.
 */
const SHARE_READ_LIMIT_WINDOW_SECONDS = 60;
const SHARE_READ_LIMIT_PER_TOKEN = 60;
const SHARE_READ_LIMIT_PER_IP = 120;

/**
 * No authenticated actor here by design. `app` is the SAME {@link TraceApp} the authenticated
 * explorer reads through, which stops this surface drifting behind an in-app redaction — the
 * span reads below are the explorer's own, not a second copy of them.
 */
export type SharedTraceTrpcContext = Readonly<{
  app: Readonly<{ traces: TraceApp }>;
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
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
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

type ShareTraceApp = SharedTraceTrpcContext["app"]["traces"];
type ShareProtections = NonNullable<
  Awaited<ReturnType<SharedTraceTrpcPorts["tryGetShareViewerProtections"]>>
>;

/**
 * The share this token names, after the rate limit and the viewer dedupe key. This is the one
 * trace read the open internet can drive, and each call costs five ClickHouse reads plus a view
 * write, so the limit is per token AND per IP: per-token alone lets one host spread load across
 * many leaked tokens, per-IP alone lets a distributed caller hammer a single link.
 */
async function resolveShareForRead({
  token,
  ctx,
  ports,
}: {
  token: string;
  ctx: SharedTraceTrpcContext;
  ports: SharedTraceTrpcPorts;
}): Promise<{ projectId: string; resourceId: string }> {
  const viewer: ShareViewer = ctx.session?.user
    ? { type: "user", id: ctx.session.user.id }
    : { type: "anonymous" };

  const clientIp = ports.getClientIp(ctx.req);
  await enforceShareReadLimit({ token, clientIp, rateLimit: ports.rateLimit });

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
  const share = await ctx.app.traces.resolveShareForViewer({
    token,
    viewer,
    ...(viewerKey !== undefined ? { viewerKey } : {}),
  });

  if (share.resourceType !== "TRACE") {
    // The read-only viewer only renders traces; a THREAD-typed share has no
    // renderable payload here.
    throw new ShareLinkNotFoundError();
  }

  return share;
}

/**
 * The cached payload, re-parsed through the same output schema rather than trusted: a stale
 * entry written by an older deploy is stripped to today's share contract instead of replaying a
 * field since removed from it. The lookup happens AFTER the token resolved and protections were
 * computed — never before — so a revoked, expired or exhausted link stops serving immediately.
 */
async function readValidatedCache({
  app,
  token,
  protections,
}: {
  app: ShareTraceApp;
  token: string;
  protections: ShareProtections;
}): Promise<SharedTraceDto | undefined> {
  const cached = await app.readCachedSharePayload({ token, protections });
  if (!cached) return undefined;

  const revalidated = sharedTraceDtoSchema.safeParse(cached);

  return revalidated.success ? revalidated.data : undefined;
}

/**
 * Every read one share page needs. The summary is fetched first: it locates the trace in time,
 * so every remaining ClickHouse read carries an OccurredAt hint and prunes to the trace's
 * partitions instead of scanning cold storage — this endpoint is unauthenticated, so an unhinted
 * scan would be an easy resource sink. A share whose trace no longer exists (retention,
 * deletion) resolves to the same generic NOT_FOUND as a bad token.
 */
async function readShareSources({
  app,
  projectId,
  traceId,
  protections,
  ports,
}: {
  app: ShareTraceApp;
  projectId: string;
  traceId: string;
  protections: ShareProtections;
  ports: SharedTraceTrpcPorts;
}) {
  let summary;
  try {
    summary = await app.readTraceSummary({
      projectId,
      traceId,
      visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
    });
  } catch (error) {
    if (ports.isTraceNotFound(error)) throw new ShareLinkNotFoundError();
    throw error;
  }
  const occurredAtMs = summary.occurredAt;

  const [project, summaryRows, fullSpans, signalRows, resourceRows, eventRows, evaluationsByTrace] =
    await Promise.all([
      app.readProject(projectId),
      app.readSpanSummaries({ projectId, traceId, occurredAtMs }),
      app.readSpans({
        projectId,
        traceId,
        occurredAtMs,
        visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
      }),
      app.readLangwatchSignals({ projectId, traceId, occurredAtMs }),
      app.readSpanResources({ projectId, traceId, occurredAtMs }),
      app.readTraceEvents({ projectId, traceId, occurredAtMs }),
      app.readEvaluations({ projectId, traceIds: [traceId], protections }),
    ]);

  return {
    summary,
    project,
    summaryRows,
    fullSpans,
    signalRows,
    resourceRows,
    eventRows,
    evaluationsByTrace,
  };
}

/**
 * The share payload: header, waterfall, span detail, resources, events and evaluations, each
 * through the same redaction the in-app reads use so this surface can never drift behind one.
 */
async function buildSharedTraceDto({
  projectId,
  traceId,
  protections,
  sources,
  ports,
}: {
  projectId: string;
  traceId: string;
  protections: ShareProtections;
  sources: Awaited<ReturnType<typeof readShareSources>>;
  ports: SharedTraceTrpcPorts;
}): Promise<SharedTraceDto> {
  const { summary, project, summaryRows, fullSpans, signalRows, resourceRows, eventRows } = sources;

  // Header (spend stripped; the DROP banner derives exactly as the
  // internal `tracesV2.header` read derives it, so a drop-policy trace
  // explains its missing content on the share page too).
  const rawHeader = mapTraceSummaryToHeader(summary);
  const header = gateHeaderCost({
    header: redactV2Content(rawHeader, protections, ports.mappers.contentPrivacy),
    protections,
  });
  header.privacy = await deriveTraceDropPrivacy(rawHeader, projectId, ports.mappers.contentPrivacy);

  // Span waterfall (spend stripped).
  const spanTree = gateTreeCost({
    nodes: summaryRows.map(mapLegacySpanSummaryToTreeNode),
    protections,
  });

  // Full span detail — the same pipeline as `tracesV2.spansFull`, shared so this
  // surface can never drift behind an in-app redaction. Capped since this endpoint is
  // unauthenticated: only per-span detail stops, and the payload says so.
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
    evaluations: sources.evaluationsByTrace[traceId] ?? [],
    protections,
  });

  return {
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
    spanSignals: signalRows.map((row) => ({ spanId: row.spanId, signals: row.signals })),
    resources,
    events: ports.mappers.spanProtection.applyDerivedTraceEventProtections(eventRows, protections),
    isSpanDetailTruncated,
    evaluations,
  };
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

    // The share-safe DTO's field stripping is a security guarantee (ADR-057:
    // a new column on an internal read must be dropped at the share boundary,
    // not silently published), and the chain's own `withOutput` deliberately
    // never strips — it only validates. So the real tRPC `.output()` stays
    // applied to the base procedure itself, and `withOutput` below is the
    // chain's own declaration/validation on top of that unchanged behaviour.
    const outputBoundProcedure = procedure.output(sharedTraceDtoSchema);

    /** `noPermission` is a pre-built decorator; `policy` here is never called. */
    const policy = (): TrpcPolicyDecorator => {
      throw new Error(
        "sharedTrace declares its access via noPermission for every procedure; policy() is unused",
      );
    };

    return createTrpcService({
      root: trpc,
      procedures: { protected: outputBoundProcedure, policy },
      validateOutput: procedures.validateOutput,
    })
      .query("get", (p) =>
        p
          .withInput(z.object({ token: z.string() }))
          .withOutput(sharedTraceDtoSchema)
          .withCustomPermission(
            noPermission({
              reason: "the share token in the input is the whole authorization; see ADR-057",
            }),
            "the share token in the input is the whole authorization; see ADR-057",
          )
          .handle(async ({ input, ctx }) => {
            const share = await resolveShareForRead({ token: input.token, ctx, ports });

            const { projectId, resourceId: traceId } = share;

            // Cost visibility follows the viewer's OWN `cost:view` permission, so sharing never
            // widens what a viewer could already see in-app (ADR-057). A missing or archived
            // project resolves like a bad token (generic NOT_FOUND).
            const protections = await ports.tryGetShareViewerProtections({
              projectId,
              session: ctx.session,
            });
            if (!protections) throw new ShareLinkNotFoundError();

            const app = ctx.app.traces;

            const cached = await readValidatedCache({ app, token: input.token, protections });
            if (cached) return cached;

            const sources = await readShareSources({ app, projectId, traceId, protections, ports });

            const dto = await buildSharedTraceDto({
              projectId,
              traceId,
              protections,
              sources,
              ports,
            });

            // Best-effort: a cache write failure is logged, never fatal to the read.
            await app.writeCachedSharePayload({
              token: input.token,
              protections,
              payload: dto,
            });

            return dto;
          }),
      )
      .build();
  }
}
