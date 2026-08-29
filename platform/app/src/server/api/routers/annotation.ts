/**
 * Process wiring for the `annotation.*` tRPC surface.
 *
 * The transport is package-owned — `AnnotationTrpcApi` in
 * `@langwatch/annotation-server`, mounted through
 * `@langwatch/platform-api/app-trpc` — and so are the queue rows
 * (`PostgresAnnotationQueueAdapter`) and the queueing itself
 * (`createOrUpdateQueueItems`). What is left here is the composition this
 * application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, and the capabilities annotation does not own —
 * the caller's read-time redactions, the trace reads that resolve an item's
 * content for a reviewer, the trace-correction overlay a suggested output is
 * carried into, and the trace storage that answers which ids address a trace.
 */
import type { resolveAnnotationSuggestionTarget } from "@langwatch/annotation-contract";
import {
  createOrUpdateQueueItems,
  PostgresAnnotationQueueAdapter,
} from "@langwatch/annotation-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createAnnotationTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { ClickHouseTraceService } from "~/server/traces/clickhouse-trace.service";
import { TraceEditOverlayService } from "~/server/traces/edit-overlay/traceEditOverlay.service";
import { slugify } from "~/utils/slugify";
import type { TRPCContext } from "../trpc.context";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";
import { getUserProtectionsForProject } from "../utils";

/** This process's concrete policy chain, in the order the mount applies it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

/** The slug `/annotations/<slug>` addresses, for a queue name. */
export const toAnnotationQueueSlug = (name: string): string =>
  slugify(name.replace("_", "-"), { lower: true, strict: true });

/** The trace content behind a set of queue items, resolved in full (#4991). */
export async function loadQueueItemTraces(
  ctx: TRPCContext,
  { projectId, traceIds }: { projectId: string; traceIds: readonly string[] },
) {
  const protections = await getUserProtectionsForProject(ctx, { projectId });
  // Annotators label trace content — resolve full IO (#4991) so they see the
  // whole value, not the 64 KB preview.
  return ctx.app.traces.readTracesWithSpans({
    projectId,
    traceIds: [...traceIds],
    protections,
  });
}

/** Writes one suggestion into the trace's correction, or takes it back off when
 *  the reviewer cleared the text. */
export async function writeAnnotationSuggestionToOverlay({
  prisma,
  projectId,
  traceId,
  target,
  text,
  userId,
}: {
  prisma: PrismaClient;
  projectId: string;
  traceId: string;
  target: NonNullable<ReturnType<typeof resolveAnnotationSuggestionTarget>>;
  text: string;
  userId: string;
}): Promise<void> {
  const overlay = TraceEditOverlayService.create(prisma);
  const withdrawn = text.length === 0;
  if (target.kind === "span") {
    const span = { projectId, traceId, spanId: target.spanId, userId };
    await (withdrawn
      ? overlay.removeSpanFieldEdit({ ...span, field: target.field })
      : overlay.mergeSpanFieldEdit({ ...span, field: target.field, text }));
    return;
  }

  const trace = { projectId, traceId, field: target.field, userId };
  await (withdrawn
    ? overlay.removeTraceIOEdit(trace)
    : overlay.mergeTraceIOEdit({ ...trace, value: text }));
}

export const annotationRouter = createAnnotationTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    // Queue rows are still application-owned storage, and the request's own
    // client is what reaches them.
    queues: (ctx: TRPCContext) =>
      PostgresAnnotationQueueAdapter.create({ database: ctx.prisma }).build(),

    // A suggested output rewrites the trace itself, so it is carried over only
    // for a caller who may also update annotations. The declared check on the
    // procedure covers the annotation; this covers the correction.
    probeProjectPermission: (ctx: TRPCContext, projectId: string, permission: AuthzPermission) =>
      probeProjectPermission(ctx, projectId, permission),

    writeTraceSuggestion: (ctx: TRPCContext, { projectId, traceId, target, text, userId }) =>
      writeAnnotationSuggestionToOverlay({
        prisma: ctx.prisma,
        projectId,
        traceId,
        target,
        text,
        userId,
      }),

    loadTraces: (ctx: TRPCContext, input) => loadQueueItemTraces(ctx, input),

    // The trace-side write is an eventing command rather than an application
    // operation: carrying a comment onto the trace is ingestion into the trace
    // pipeline, not a rule the trace application owns.
    recordAnnotationOnTrace: (ctx: TRPCContext, input) =>
      ctx.app.commands.traces.addAnnotation(input),

    removeAnnotationFromTrace: (ctx: TRPCContext, input) =>
      ctx.app.commands.traces.removeAnnotation(input),

    queueTracesForAnnotation: (ctx: TRPCContext, input) =>
      createOrUpdateQueueItems({
        traceIds: [...input.traceIds],
        projectId: input.projectId,
        annotators: [...input.annotators],
        userId: input.userId,
        annotations: ctx.app.annotations.annotationService,
        // Which ids address a trace this project holds is trace storage's
        // answer, so it is resolved here rather than inside the queueing.
        findExistingTraceIds: (candidates) =>
          ClickHouseTraceService.create({
            prisma: ctx.prisma,
            traceCanonicalisation: ctx.app.traces.canonicalisation,
          }).findExistingTraceIds(candidates),
      }),

    toQueueSlug: toAnnotationQueueSlug,
  },
});
