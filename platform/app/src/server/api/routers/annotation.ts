/**
 * Process wiring for the `annotation.*` tRPC surface.
 *
 * The transport itself is package-owned — `AnnotationTrpcApi` in
 * `@langwatch/annotation-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, and the capabilities annotation does not own —
 * the `AnnotationQueue` / `AnnotationQueueItem` rows, the trace reads that
 * resolve an item's content for a reviewer, and the trace-correction overlay a
 * suggested output is carried into.
 */
import type {
  AnnotationService,
  resolveAnnotationSuggestionTarget,
} from "@langwatch/annotation-contract";
import type { AnnotationQueueStore } from "@langwatch/annotation-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  createAnnotationTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
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

const logger = createLogger("langwatch:api:annotation");

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


/**
 * Every queue item the caller's organization can see: one whose queue belongs
 * to this project, and whose assignee is a member of the organization the
 * project belongs to.
 */
const queueItemReferenceFilter = ({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) => ({
  projectId,
  AND: [
    {
      OR: [{ annotationQueueId: null }, { annotationQueue: { projectId } }],
    },
    {
      OR: [
        { userId: null },
        {
          user: {
            orgMemberships: { some: { organizationId } },
          },
        },
      ],
    },
  ],
});

/**
 * The list's date range, as a `where` fragment. A queue item is dated by when
 * it was queued, which is what the reviewer sees in the list and filters on.
 * Empty when no range was asked for, so it spreads into a `where` either way.
 */
const queuedAtRangeFilter = ({
  startDate,
  endDate,
}: {
  startDate?: Date;
  endDate?: Date;
}): { createdAt?: { gte?: Date; lte?: Date } } => {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (startDate) createdAt.gte = startDate;
  if (endDate) createdAt.lte = endDate;
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
};

/**
 * The queue items a reviewer is responsible for: assigned to them directly, or
 * sitting in a queue they belong to. Same reach as the pending and assigned
 * counts, so what the queue page walks and what it hands to a dataset agree.
 */
const callerQueueItemsFilter = ({
  projectId,
  organizationId,
  userId,
}: {
  projectId: string;
  organizationId: string;
  userId: string;
}) => {
  const reference = queueItemReferenceFilter({ projectId, organizationId });
  return {
    ...reference,
    AND: [
      ...reference.AND,
      {
        OR: [
          { userId },
          {
            annotationQueue: {
              projectId,
              members: { some: { userId } },
            },
          },
        ],
      },
    ],
  };
};

const queueMemberInclude = (organizationId: string) => ({
  where: {
    user: {
      orgMemberships: { some: { organizationId } },
    },
  },
  include: { user: true },
});

const queueScoreInclude = (projectId: string) => ({
  where: { annotationScore: { projectId } },
  include: { annotationScore: true },
});

/** The `AnnotationQueue` and `AnnotationQueueItem` rows, over Prisma. */
export function createAnnotationQueueStore(prisma: PrismaClient) {
  const store = {
    async queueSlugExists({ projectId, slug }: { projectId: string; slug: string }) {
      const existing = await prisma.annotationQueue.findFirst({
        where: { slug, projectId },
      });
      return existing !== null;
    },

    createQueue({
      projectId,
      name,
      slug,
      description,
      userIds,
      scoreTypeIds,
    }: {
      projectId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }) {
      return prisma.annotationQueue.create({
        data: {
          projectId,
          name,
          slug,
          description,
          members: { create: userIds.map((userId) => ({ userId })) },
          AnnotationQueueScores: {
            create: scoreTypeIds.map((scoreTypeId) => ({
              annotationScoreId: scoreTypeId,
            })),
          },
        },
      });
    },

    updateQueue({
      projectId,
      queueId,
      name,
      slug,
      description,
      userIds,
      scoreTypeIds,
    }: {
      projectId: string;
      queueId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }) {
      return prisma.annotationQueue.update({
        data: {
          projectId,
          name,
          slug,
          description,
          members: {
            deleteMany: {},
            create: userIds.map((userId) => ({ userId })),
          },
          AnnotationQueueScores: {
            deleteMany: {},
            create: scoreTypeIds.map((scoreTypeId) => ({
              annotationScoreId: scoreTypeId,
            })),
          },
        },
        where: { id: queueId, projectId },
      });
    },

    listQueues({ projectId }: { projectId: string }) {
      return prisma.annotationQueue.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          // The slug is what `/annotations/<slug>` addresses, so anything that
          // links straight to a queue it just wrote to needs it here.
          slug: true,
        },
        orderBy: { createdAt: "desc" },
      });
    },

    findQueue({
      projectId,
      organizationId,
      slug,
      queueId,
    }: {
      projectId: string;
      organizationId: string;
      slug?: string;
      queueId?: string;
    }) {
      return prisma.annotationQueue.findUnique({
        where: queueId
          ? { id: queueId, projectId }
          : { projectId_slug: { projectId, slug: slug! } },
        include: {
          members: queueMemberInclude(organizationId),
          AnnotationQueueScores: queueScoreInclude(projectId),
        },
      });
    },

    listQueueItems({
      projectId,
      organizationId,
    }: {
      projectId: string;
      organizationId: string;
    }) {
      return prisma.annotationQueueItem.findMany({
        where: queueItemReferenceFilter({ projectId, organizationId }),
        include: {
          user: true,
          createdByUser: true,
          annotationQueue: {
            include: {
              members: {
                where: {
                  user: { orgMemberships: { some: { organizationId } } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    },

    countPendingItems({ projectId, userId }: { projectId: string; userId: string }) {
      return prisma.annotationQueueItem.count({
        where: {
          projectId,
          doneAt: null,
          OR: [
            { userId },
            {
              annotationQueue: {
                projectId,
                members: { some: { userId } },
              },
            },
          ],
        },
      });
    },

    countAssignedItems({ projectId, userId }: { projectId: string; userId: string }) {
      return prisma.annotationQueueItem.count({
        where: { projectId, doneAt: null, userId },
      });
    },

    async listMemberQueuePendingCounts({
      projectId,
      userId,
    }: {
      projectId: string;
      userId: string;
    }) {
      const memberQueues = await prisma.annotationQueue.findMany({
        where: { projectId, members: { some: { userId } } },
        select: { id: true, name: true, slug: true },
      });

      const queueIds = memberQueues.map((queue) => queue.id);
      if (queueIds.length === 0) return [];

      // One grouped count rather than one query per queue.
      const queueCounts = await prisma.annotationQueueItem.groupBy({
        by: ["annotationQueueId"],
        where: {
          projectId,
          annotationQueueId: { in: queueIds },
          doneAt: null,
        },
        _count: { annotationQueueId: true },
      });

      const countMap = new Map(
        queueCounts.map((item) => [
          item.annotationQueueId,
          item._count.annotationQueueId,
        ]),
      );

      return memberQueues.map((queue) => ({
        id: queue.id,
        name: queue.name,
        slug: queue.slug,
        pendingCount: countMap.get(queue.id) ?? 0,
      }));
    },

    async deleteQueueItems({
      projectId,
      organizationId,
      userId,
      queueItemIds,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemIds: readonly string[];
    }) {
      const result = await prisma.annotationQueueItem.deleteMany({
        where: {
          ...callerQueueItemsFilter({ projectId, organizationId, userId }),
          id: { in: [...queueItemIds] },
        },
      });
      return result.count;
    },

    async markQueueItemDone({
      projectId,
      organizationId,
      userId,
      queueItemId,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemId: string;
    }) {
      const result = await prisma.annotationQueueItem.updateMany({
        where: {
          ...callerQueueItemsFilter({ projectId, organizationId, userId }),
          id: queueItemId,
        },
        data: { doneAt: new Date() },
      });
      if (result.count === 0) return { matched: false as const, item: null };

      return {
        matched: true as const,
        item: await prisma.annotationQueueItem.findFirstOrThrow({
          where: { id: queueItemId, projectId },
        }),
      };
    },

    async listQueueItemsPage({
      projectId,
      organizationId,
      userId,
      status,
      queueId,
      includeMemberQueues,
      startDate,
      endDate,
      pageSize,
      pageOffset,
      allQueueItems,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      status: "pending" | "completed" | "all";
      queueId?: string;
      includeMemberQueues: boolean;
      startDate?: Date;
      endDate?: Date;
      pageSize: number;
      pageOffset: number;
      allQueueItems: boolean;
    }) {
      // A queue was named, so which queues the caller belongs to changes
      // nothing about what the page shows.
      const userQueueIds = includeMemberQueues
        ? (
            await prisma.annotationQueue.findMany({
              where: { projectId, members: { some: { userId } } },
            })
          ).map((queue) => queue.id)
        : [];

      const reference = queueItemReferenceFilter({ projectId, organizationId });
      const scope = queueId
        ? // Pin the requested queue to the caller's project so a queue id from
          // another tenant cannot surface its items here.
          { AND: [...reference.AND, { annotationQueue: { id: queueId, projectId } }] }
        : userQueueIds.length > 0
          ? // No specific queue requested: include items from the queues the
            // caller belongs to, plus items assigned directly to them.
            {
              AND: [
                ...reference.AND,
                { OR: [{ annotationQueueId: { in: userQueueIds } }, { userId }] },
              ],
            }
          : // Default case - just user's items
            { AND: reference.AND, userId };

      const whereCondition = {
        ...reference,
        doneAt:
          status === "pending" ? null : status === "completed" ? { not: null } : void 0,
        ...queuedAtRangeFilter({ startDate, endDate }),
        ...scope,
      };

      const totalCount = await prisma.annotationQueueItem.count({
        where: whereCondition,
      });

      const items = await prisma.annotationQueueItem.findMany({
        where: whereCondition,
        take: allQueueItems ? void 0 : pageSize,
        skip: allQueueItems ? void 0 : pageOffset,
        include: {
          user: true,
          createdByUser: true,
          annotationQueue: {
            include: {
              members: queueMemberInclude(organizationId),
              AnnotationQueueScores: queueScoreInclude(projectId),
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return { totalCount, items };
    },

    listQueuesWithItems({
      projectId,
      organizationId,
      queueIds,
    }: {
      projectId: string;
      organizationId: string;
      queueIds: readonly string[];
    }) {
      return prisma.annotationQueue.findMany({
        where: { id: { in: [...queueIds] }, projectId },
        include: {
          members: queueMemberInclude(organizationId),
          AnnotationQueueScores: queueScoreInclude(projectId),
          AnnotationQueueItems: {
            where: {
              projectId,
              OR: [
                { userId: null },
                { user: { orgMemberships: { some: { organizationId } } } },
              ],
            },
            include: { user: true, annotationQueue: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    },
  };

  // Compile-time proof that the process still answers the whole port the
  // feature transport asks for.
  store satisfies AnnotationQueueStore;
  return store;
}

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
  return ctx.app.traces.read.getTracesWithSpans(
    projectId,
    [...traceIds],
    protections,
    void 0,
    { full: true },
  );
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

const annotatorReferenceSchema = z.string().transform((annotator, ctx) => {
  if (annotator.startsWith("queue-") && annotator.length > 6) {
    return { type: "queue" as const, id: annotator.slice(6) };
  }
  if (annotator.startsWith("user-") && annotator.length > 5) {
    return { type: "user" as const, id: annotator.slice(5) };
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid annotator" });
  return z.NEVER;
});

type AnnotatorReference = z.infer<typeof annotatorReferenceSchema>;

/** Which of these ids the project holds a trace for. */
type FindExistingTraceIds = (args: {
  projectId: string;
  traceIds: string[];
}) => Promise<string[]>;

/**
 * The ids worth writing a queue item for, out of what a caller sent. A queue
 * item is a promise that there is something to review, so:
 *   - blank ids address no trace and are dropped;
 *   - a repeated id survives once. The upsert reopens a finished item
 *     (`doneAt: null`), so running it twice for one id in one call would
 *     un-finish work the reviewer had already completed;
 *   - an id no trace answers to is skipped. It would otherwise become an item
 *     the reviewer cannot read, cannot annotate, and cannot get past.
 */
const resolveQueueableTraceIds = async ({
  traceIds,
  projectId,
  findExistingTraceIds,
}: {
  traceIds: string[];
  projectId: string;
  findExistingTraceIds: FindExistingTraceIds;
}): Promise<string[]> => {
  const candidates = [
    ...new Set(traceIds.map((traceId) => traceId.trim()).filter(Boolean)),
  ];
  const resolvable = new Set(
    await findExistingTraceIds({ projectId, traceIds: candidates }),
  );
  const queueable = candidates.filter((traceId) => resolvable.has(traceId));

  if (queueable.length < traceIds.length) {
    logger.info(
      { projectId, sent: traceIds.length, queued: queueable.length },
      "Dropped trace ids that resolve to no trace when queueing for annotation",
    );
  }
  return queueable;
};

/**
 * Queues traces for annotation, for everything that can queue one: the trace
 * table's selection bar, the trace drawer, and the automations that hand traces
 * over on their own.
 *
 * @returns how many ids were queued and how many were skipped (everything sent
 *   that did not become work), so the surface that sent them can say what
 *   actually happened.
 */
export async function createOrUpdateQueueItems({
  traceIds,
  projectId,
  annotators,
  userId,
  prisma,
  annotations,
  traceCanonicalisation,
  findExistingTraceIds = ({ projectId: forProject, traceIds: candidates }) =>
    ClickHouseTraceService.create({ prisma, traceCanonicalisation }).findExistingTraceIds(
      {
        projectId: forProject,
        traceIds: candidates,
      },
    ),
}: {
  traceIds: string[];
  projectId: string;
  annotators: string[];
  userId: string;
  prisma: PrismaClient;
  annotations: AnnotationService;
  traceCanonicalisation: TraceCanonicalisationService;
  findExistingTraceIds?: FindExistingTraceIds;
}): Promise<{ created: number; skipped: number }> {
  const parsedAnnotators: AnnotatorReference[] = annotators.map((annotator) => {
    const parsed = annotatorReferenceSchema.safeParse(annotator);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid annotator",
      });
    }
    return parsed.data;
  });
  const queueIds = parsedAnnotators
    .filter((annotator) => annotator.type === "queue")
    .map((annotator) => annotator.id);
  const userIds = parsedAnnotators
    .filter((annotator) => annotator.type === "user")
    .map((annotator) => annotator.id);

  await annotations.assertAnnotatorReferences({ projectId, queueIds, userIds });

  const queueableTraceIds = await resolveQueueableTraceIds({
    traceIds,
    projectId,
    findExistingTraceIds,
  });

  await annotations.createQueueItems({
    projectId,
    traceIds: queueableTraceIds,
    queueIds,
    userIds,
    createdByUserId: userId,
  });

  return {
    created: queueableTraceIds.length,
    skipped: traceIds.length - queueableTraceIds.length,
  };
}

export const annotationRouter = createAnnotationTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    // Queue rows are still application-owned storage, and the request's own
    // client is what reaches them.
    queues: (ctx: TRPCContext) => createAnnotationQueueStore(ctx.prisma),

    // A suggested output rewrites the trace itself, so it is carried over only
    // for a caller who may also update annotations. The declared check on the
    // procedure covers the annotation; this covers the correction.
    probeProjectPermission: (
      ctx: TRPCContext,
      projectId: string,
      permission: AuthzPermission,
    ) => probeProjectPermission(ctx, projectId, permission),

    writeTraceSuggestion: (
      ctx: TRPCContext,
      { projectId, traceId, target, text, userId },
    ) =>
      writeAnnotationSuggestionToOverlay({
        prisma: ctx.prisma,
        projectId,
        traceId,
        target,
        text,
        userId,
      }),

    loadTraces: (ctx: TRPCContext, input) => loadQueueItemTraces(ctx, input),

    recordAnnotationOnTrace: (ctx: TRPCContext, input) =>
      ctx.app.traces.addAnnotation(input),

    removeAnnotationFromTrace: (ctx: TRPCContext, input) =>
      ctx.app.traces.removeAnnotation(input),

    queueTracesForAnnotation: (ctx: TRPCContext, input) =>
      createOrUpdateQueueItems({
        traceIds: [...input.traceIds],
        projectId: input.projectId,
        annotators: [...input.annotators],
        userId: input.userId,
        prisma: ctx.prisma,
        annotations: ctx.app.annotations,
        traceCanonicalisation: ctx.app.traces.canonicalisation,
      }),

    toQueueSlug: toAnnotationQueueSlug,
  },
});
