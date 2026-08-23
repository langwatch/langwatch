import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  AnnotationQueueItem,
  PrismaClient,
} from "~/generated/prisma/client";
import { AnnotationService } from "~/server/annotations/annotation.service";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeSchema,
  annotationAnchorScopeWhere,
  refineAnnotationAnchorColumns,
  resolveAnnotationSuggestionTarget,
  withReadableAnnotationAnchor,
} from "~/server/annotations/annotationAnchor";
import { getApp } from "~/server/app-layer/app";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import type { Session } from "~/server/auth";
import { ClickHouseTraceService } from "~/server/traces/clickhouse-trace.service";
import { TraceEditOverlayService } from "~/server/traces/edit-overlay/traceEditOverlay.service";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { slugify } from "~/utils/slugify";
import type { Protections } from "../../traces/protections";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

const logger = createLogger("langwatch:api:annotation");

const scoreOptionSchema = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  reason: z.string().optional().nullable(),
});

const scoreOptions = z.record(z.string(), scoreOptionSchema);

// Helper function to fetch and enrich queue items with traces and annotations
const enrichQueueItemsWithTracesAndAnnotations = async (
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  queueItems: AnnotationQueueItem[],
  protections: Protections,
) => {
  // Get all unique trace IDs from queue items
  const traceIds = [...new Set(queueItems.map((item) => item.traceId))];

  // Get all annotations for these traces in a single query. A queue item is a
  // whole trace to review, so it carries every comment left on that trace,
  // each one naming the part of it that was commented on.
  const annotations = await ctx.prisma.annotation.findMany({
    where: {
      projectId: projectId,
      traceId: {
        in: traceIds,
      },
      ...annotationAnchorScopeWhere("all"),
    },
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Annotators label trace content — resolve full IO (#4991) so they see the
  // whole value, not the 64 KB preview.
  const traceService = TraceService.create(
    ctx.prisma,
    buildTraceBlobResolutionDeps(),
  );
  const traces = await traceService.getTracesWithSpans(
    projectId,
    traceIds,
    protections,
    undefined,
    { full: true },
  );

  // Create lookup maps for O(1) access
  const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));
  const annotationMap = new Map<string, Array<(typeof annotations)[number]>>();

  annotations.forEach((annotation) => {
    if (!annotationMap.has(annotation.traceId)) {
      annotationMap.set(annotation.traceId, []);
    }
    const annotationArray = annotationMap.get(annotation.traceId);
    if (annotationArray) {
      annotationArray.push(annotation);
    }
  });

  // Enrich queue items with traces and annotations
  return queueItems.map((item) => ({
    ...item,
    trace: traceMap.get(item.traceId) ?? null,
    annotations: annotationMap.get(item.traceId) ?? [],
    scoreOptions: (annotationMap.get(item.traceId) ?? []).flatMap(
      (annotation) =>
        annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : [],
    ),
  }));
};

// Helper function to safely get enriched items
const getEnrichedItems = <T extends { id: string }>(
  queueItems: T[],
  enrichedItemMap: Map<string, any>,
) => {
  return queueItems
    .map((item) => enrichedItemMap.get(item.id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
};

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

/** Writes one suggestion into the trace's correction, or takes it back off when
 *  the reviewer cleared the text. */
const writeSuggestionToOverlay = async ({
  overlay,
  projectId,
  traceId,
  target,
  text,
  userId,
}: {
  overlay: TraceEditOverlayService;
  projectId: string;
  traceId: string;
  target: NonNullable<ReturnType<typeof resolveAnnotationSuggestionTarget>>;
  text: string;
  userId: string;
}) => {
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
};

/**
 * Carries a suggestion over to the trace's correction. The annotation row stays
 * the record of who suggested what; the correction is the trace's current
 * corrected truth and is what the dataset flow reads.
 *
 * Where the suggestion lands is the comment's anchor: a comment on a field
 * corrects that field of what it names, the trace's own input or output or a
 * span's; a comment about the whole trace corrects the trace output. An anchor
 * with nothing for a suggestion to correct (a whole span, an attribute row, a
 * message) carries none, which is also what the composer offers there.
 *
 * Only a suggestion that actually CHANGED is carried over, which is what makes
 * the two sides safe to keep in step:
 *   - no suggestion field at all (undefined) leaves the correction alone;
 *   - the same text the annotation already held is not re-asserted, so saving a
 *     comment on an old annotation cannot overwrite a newer correction with the
 *     text the form loaded when it opened;
 *   - clearing the text withdraws the corrected field, leaving every other
 *     edit on the trace in place. A save that never held a suggestion has
 *     nothing to withdraw, so an ordinary comment never removes a correction
 *     made elsewhere.
 *
 * Writing a correction is `annotations:update` work on every other surface, so
 * a reviewer who may only create annotations still gets their annotation and
 * simply does not move the correction.
 *
 * Runs BEFORE the annotation is written and is deliberately not best-effort: a
 * suggestion the reviewer believes was saved but which never reached the
 * correction would silently ship the uncorrected trace into a dataset. Merging
 * the same text twice is a no-op, so a retry after a failed annotation write
 * costs nothing, while the reverse order would leave a duplicate annotation
 * behind on every retry.
 */
const carrySuggestionToOverlay = async ({
  ctx,
  projectId,
  traceId,
  expectedOutput,
  previousExpectedOutput,
  userId,
  anchorKind,
  anchorId,
  anchorPath,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  projectId: string;
  traceId: string;
  expectedOutput?: string | null;
  previousExpectedOutput?: string | null;
  userId: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}) => {
  if (expectedOutput === undefined) return;
  const next = expectedOutput ?? "";
  const previous = previousExpectedOutput ?? "";
  if (next === previous) return;

  const target = resolveAnnotationSuggestionTarget({
    traceId,
    anchorKind,
    anchorId,
    anchorPath,
  });
  if (!target) return;

  if (!(await probeProjectPermission(ctx, projectId, "annotations:update"))) {
    return;
  }

  await writeSuggestionToOverlay({
    overlay: TraceEditOverlayService.create(ctx.prisma),
    projectId,
    traceId,
    target,
    text: next,
    userId,
  });
};

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

export const annotationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          comment: z.string().optional().nullable(),
          isThumbsUp: z.boolean().optional().nullable(),
          traceId: z.string(),
          scoreOptions: scoreOptions,
          expectedOutput: z.string().optional().nullable(),
        })
        .merge(annotationAnchorColumnsSchema)
        .superRefine(refineAnnotationAnchorColumns),
    )
    .permission("annotations:create")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });

      await carrySuggestionToOverlay({
        ctx,
        projectId: input.projectId,
        traceId: input.traceId,
        expectedOutput: input.expectedOutput,
        userId: ctx.session.user.id,
        anchorKind: input.anchorKind,
        anchorId: input.anchorId,
        anchorPath: input.anchorPath,
      });

      const createdAnnotation = await service.create({
        id: nanoid(),
        projectId: input.projectId,
        traceId: input.traceId,
        userId: ctx.session.user.id,
        comment: input.comment ?? "",
        isThumbsUp: input.isThumbsUp ?? null,
        scoreOptions: input.scoreOptions ?? {},
        expectedOutput: input.expectedOutput ?? null,
        anchorKind: input.anchorKind,
        anchorId: input.anchorId,
        anchorPath: input.anchorPath,
      });

      // Best-effort ClickHouse sync: Prisma is the source of truth.
      // Failures are logged but don't fail the mutation — the backfill task
      // can reconcile any missed syncs.
      //
      // Anchored comments sync too. This is what answers "has a human touched
      // this trace", which the has-annotation filter in search reads, and a
      // comment on one of its spans means yes.
      try {
        const app = getApp();
        await app.traces.addAnnotation({
          tenantId: input.projectId,
          traceId: input.traceId,
          annotationId: createdAnnotation.id,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.error(
          { error, traceId: input.traceId, projectId: input.projectId },
          "Failed to sync annotation to ClickHouse",
        );
      }

      return createdAnnotation;
    }),
  updateByTraceId: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        traceId: z.string(),
        projectId: z.string(),
        comment: z.string().optional().nullable(),
        isThumbsUp: z.boolean().optional().nullable(),
        expectedOutput: z.string().optional().nullable(),
        scoreOptions: scoreOptions,
      }),
    )
    .permission("annotations:update")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });

      // The suggestion the annotation held before this save is what tells a
      // real edit apart from a form re-sending what it loaded, so it is read
      // before the row moves. The anchor comes from the same read rather than
      // from the input: editing a comment changes what it says, never what it
      // is about, so re-anchoring is a delete and a create.
      const existing = await ctx.prisma.annotation.findFirst({
        where: { id: input.id, projectId: input.projectId },
        select: {
          expectedOutput: true,
          anchorKind: true,
          anchorId: true,
          anchorPath: true,
        },
      });

      await carrySuggestionToOverlay({
        ctx,
        projectId: input.projectId,
        traceId: input.traceId,
        expectedOutput: input.expectedOutput,
        previousExpectedOutput: existing?.expectedOutput,
        userId: ctx.session.user.id,
        anchorKind: existing?.anchorKind,
        anchorId: existing?.anchorId,
        anchorPath: existing?.anchorPath,
      });

      return service.update({
        id: input.id,
        projectId: input.projectId,
        traceId: input.traceId,
        comment: input.comment ?? "",
        isThumbsUp: input.isThumbsUp,
        scoreOptions: input.scoreOptions ?? {},
        // A save that does not carry the field leaves the suggestion where it
        // is, the same way it leaves the trace's correction alone. Only an
        // explicit null or empty text withdraws it.
        expectedOutput: input.expectedOutput,
      });
    }),
  /**
   * The comments on one trace. Defaults to every comment, anchored ones
   * included: this is the read behind a trace's own comment list, where a
   * comment about one of its spans belongs. A caller answering a question about
   * the trace as a whole asks for `anchor: "trace"` instead.
   */
  getByTraceId: protectedProcedure
    .input(
      z.object({
        traceId: z.string(),
        projectId: z.string(),
        anchor: annotationAnchorScopeSchema.optional().default("all"),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const annotations = await ctx.prisma.annotation.findMany({
        where: {
          traceId: input.traceId,
          projectId: input.projectId,
          ...annotationAnchorScopeWhere(input.anchor),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      return annotations.map(withReadableAnnotationAnchor);
    }),
  /** Same contract as `getByTraceId`, for a page of traces. */
  getByTraceIds: protectedProcedure
    .input(
      z.object({
        traceIds: z.array(z.string()),
        projectId: z.string(),
        anchor: annotationAnchorScopeSchema.optional().default("all"),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const annotations = await ctx.prisma.annotation.findMany({
        where: {
          traceId: {
            in: input.traceIds,
          },
          projectId: input.projectId,
          ...annotationAnchorScopeWhere(input.anchor),
        },
        // Only what the UI renders. `include: { user: true }` returned every
        // User column — email, emailVerified, lastLoginAt, deactivatedAt — and
        // there is no output schema on this procedure, so all of it reached
        // the browser for every annotation on screen. Mirrors the sibling
        // getByTraceId above, which already selects narrowly.
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      return annotations.map(withReadableAnnotationAnchor);
    }),
  getById: protectedProcedure
    .input(z.object({ annotationId: z.string(), projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotation.findUnique({
        where: {
          id: input.annotationId,
          projectId: input.projectId,
        },
      });
    }),
  deleteById: protectedProcedure
    .input(z.object({ annotationId: z.string(), projectId: z.string() }))
    .permission("annotations:delete")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });

      const deletedAnnotation = await service.delete({
        id: input.annotationId,
        projectId: input.projectId,
      });

      // Best-effort ClickHouse sync (see create mutation comment above).
      try {
        const app = getApp();
        await app.traces.removeAnnotation({
          tenantId: input.projectId,
          traceId: deletedAnnotation.traceId,
          annotationId: deletedAnnotation.id,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.error(
          {
            error,
            traceId: deletedAnnotation.traceId,
            projectId: input.projectId,
          },
          "Failed to sync annotation removal to ClickHouse",
        );
      }

      return deletedAnnotation;
    }),
  /**
   * The project's annotations list, and the export taken from it. One row per
   * comment, anchored ones included: a reviewer who marked six spans of one
   * trace said six things, and a list that showed none of them answered with
   * silence. Each row carries its anchor, which is what keeps them readable.
   */
  getAll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotation.findMany({
        where: {
          projectId: input.projectId,
          createdAt: {
            gte: input.startDate,
            lte: input.endDate,
          },
          ...annotationAnchorScopeWhere("all"),
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: true,
        },
      });
    }),

  createOrUpdateQueue: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        description: z.string(),
        userIds: z.array(z.string()),
        scoreTypeIds: z.array(z.string()),
        queueId: z.string().optional(),
      }),
    )
    .permission("annotations:create")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });
      await service.assertQueueConfigurationReferences({
        projectId: input.projectId,
        userIds: input.userIds,
        scoreTypeIds: input.scoreTypeIds,
      });

      const slug = slugify(input.name.replace("_", "-"), {
        lower: true,
        strict: true,
      });

      if (slug === "all" || slug === "me" || slug === "my-queue") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A annotation queue name is reserved.",
        });
      }

      if (input.queueId) {
        return ctx.prisma.annotationQueue.update({
          data: {
            projectId: input.projectId,
            name: input.name,
            slug: slug,
            description: input.description,
            members: {
              deleteMany: {},
              create: input.userIds.map((userId) => ({
                userId,
              })),
            },
            AnnotationQueueScores: {
              deleteMany: {},
              create: input.scoreTypeIds.map((scoreTypeId) => ({
                annotationScoreId: scoreTypeId,
              })),
            },
          },
          where: {
            id: input.queueId,
            projectId: input.projectId,
          },
        });
      } else {
        const existingAnnotationQueue =
          await ctx.prisma.annotationQueue.findFirst({
            where: {
              slug: slug,
              projectId: input.projectId,
            },
          });

        if (existingAnnotationQueue) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A annotation queue with this name already exists.",
          });
        }
        return ctx.prisma.annotationQueue.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            slug: slug,
            description: input.description,
            members: {
              create: input.userIds.map((userId) => ({
                userId,
              })),
            },
            AnnotationQueueScores: {
              create: input.scoreTypeIds.map((scoreTypeId) => ({
                annotationScoreId: scoreTypeId,
              })),
            },
          },
        });
      }
    }),
  getQueues: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueue.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          name: true,
          // The slug is what `/annotations/<slug>` addresses, so anything that
          // links straight to a queue it just wrote to needs it here.
          slug: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
  getQueueItems: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });
      const organizationId = await service.getProjectOrganizationId({
        projectId: input.projectId,
      });
      const queueItems = await ctx.prisma.annotationQueueItem.findMany({
        where: queueItemReferenceFilter({
          projectId: input.projectId,
          organizationId,
        }),
        include: {
          user: true,
          createdByUser: true,
          annotationQueue: {
            include: {
              members: {
                where: {
                  user: {
                    orgMemberships: { some: { organizationId } },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const traceIds = [...new Set(queueItems.map((item) => item.traceId))];
      // Annotation queue shows trace content for labeling — resolve full IO (#4991).
      const traceService = TraceService.create(
        ctx.prisma,
        buildTraceBlobResolutionDeps(),
      );
      const traces = await traceService.getTracesWithSpans(
        input.projectId,
        traceIds,
        protections,
        undefined,
        { full: true },
      );
      const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

      return queueItems.map((item) => ({
        ...item,
        trace: traceMap.get(item.traceId) ?? null,
      }));
    }),
  getPendingItemsCount: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueueItem.count({
        where: {
          projectId: input.projectId,
          doneAt: null,
          OR: [
            {
              userId: ctx.session.user.id,
            },
            {
              annotationQueue: {
                projectId: input.projectId,
                members: {
                  some: {
                    userId: ctx.session.user.id,
                  },
                },
              },
            },
          ],
        },
      });
    }),
  getAssignedItemsCount: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueueItem.count({
        where: {
          projectId: input.projectId,
          doneAt: null,
          userId: ctx.session.user.id,
        },
      });
    }),
  getQueueItemsCounts: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get queues where user is a member
      const memberQueues = await ctx.prisma.annotationQueue.findMany({
        where: {
          projectId: input.projectId,
          members: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      // Get queue IDs for the IN clause
      const queueIds = memberQueues.map((queue) => queue.id);

      if (queueIds.length === 0) {
        return [];
      }

      // Get counts for all queues in a single query using groupBy
      const queueCounts = await ctx.prisma.annotationQueueItem.groupBy({
        by: ["annotationQueueId"],
        where: {
          projectId: input.projectId,
          annotationQueueId: {
            in: queueIds,
          },
          doneAt: null,
        },
        _count: {
          annotationQueueId: true,
        },
      });

      // Create a map for O(1) lookup
      const countMap = new Map(
        queueCounts.map((item) => [
          item.annotationQueueId,
          item._count.annotationQueueId,
        ]),
      );

      // Return the result with counts mapped to queue data
      return memberQueues.map((queue) => ({
        id: queue.id,
        name: queue.name,
        slug: queue.slug,
        pendingCount: countMap.get(queue.id) ?? 0,
      }));
    }),
  createQueueItem: protectedProcedure
    .input(
      z.object({
        traceIds: z.array(z.string()),
        projectId: z.string(),
        annotators: z.array(z.string()),
      }),
    )
    .permission("annotations:create")
    .mutation(async ({ ctx, input }) => {
      return await createOrUpdateQueueItems({
        traceIds: input.traceIds,
        projectId: input.projectId,
        annotators: input.annotators,
        userId: ctx.session.user.id,
        prisma: ctx.prisma,
      });
    }),
  /**
   * Takes queue items out of the reviewer's queue for good. What it is for is
   * an item there is nothing to review on: its trace no longer resolves, so it
   * can neither be read nor annotated nor finished, and leaving it there keeps
   * the queue from ever reading as complete.
   *
   * Scoped to the items the caller is responsible for, the same reach as
   * marking and clearing marks: removing a teammate's item would take work off
   * a queue that is not the caller's to empty.
   */
  deleteQueueItems: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        queueItemIds: z.array(z.string()).min(1),
      }),
    )
    .permission("annotations:update")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });
      const organizationId = await service.getProjectOrganizationId({
        projectId: input.projectId,
      });

      const result = await ctx.prisma.annotationQueueItem.deleteMany({
        where: {
          ...callerQueueItemsFilter({
            projectId: input.projectId,
            organizationId,
            userId: ctx.session.user.id,
          }),
          id: { in: input.queueItemIds },
        },
      });
      return { deleted: result.count };
    }),
  /**
   * Marks a queue item as reviewed. Scoped to the items the caller is
   * responsible for, the same reach as marking and removing: finishing a
   * teammate's item would clear work off a queue that is not the caller's.
   */
  markQueueItemDone: protectedProcedure
    .input(z.object({ queueItemId: z.string(), projectId: z.string() }))
    .permission("annotations:update")
    .mutation(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });
      const organizationId = await service.getProjectOrganizationId({
        projectId: input.projectId,
      });

      const result = await ctx.prisma.annotationQueueItem.updateMany({
        where: {
          ...callerQueueItemsFilter({
            projectId: input.projectId,
            organizationId,
            userId: ctx.session.user.id,
          }),
          id: input.queueItemId,
        },
        data: {
          doneAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Queue item not found",
        });
      }

      return ctx.prisma.annotationQueueItem.findFirstOrThrow({
        where: { id: input.queueItemId, projectId: input.projectId },
      });
    }),
  getQueueBySlugOrId: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        slug: z.string().optional(),
        queueId: z.string().optional(),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const service = AnnotationService.create({ prisma: ctx.prisma });
      const organizationId = await service.getProjectOrganizationId({
        projectId: input.projectId,
      });
      return ctx.prisma.annotationQueue.findUnique({
        where: input.queueId
          ? { id: input.queueId, projectId: input.projectId }
          : {
              projectId_slug: { projectId: input.projectId, slug: input.slug! },
            },
        include: {
          members: {
            where: {
              user: {
                orgMemberships: { some: { organizationId } },
              },
            },
            include: {
              user: true,
            },
          },
          AnnotationQueueScores: {
            where: { annotationScore: { projectId: input.projectId } },
            include: {
              annotationScore: true,
            },
          },
        },
      });
    }),
  getOptimizedAnnotationQueues: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        selectedAnnotations: z.string(),
        pageSize: z.number(),
        pageOffset: z.number(),
        queueId: z.string().optional(),
        showQueueAndUser: z.boolean().optional(),
        allQueueItems: z.boolean().optional(),
        // The list's date range. A queue item is dated by when it was queued,
        // which is what the reviewer sees in the list and filters on.
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const service = AnnotationService.create({ prisma: ctx.prisma });
      const organizationId = await service.getProjectOrganizationId({
        projectId: input.projectId,
      });
      let userQueueIds: string[] = [];

      // If a queue is selected, we don't need to check for user queues
      if (input.showQueueAndUser) {
        const queues = await ctx.prisma.annotationQueue.findMany({
          where: {
            projectId: input.projectId,
            members: {
              some: {
                userId: userId,
              },
            },
          },
        });
        userQueueIds = queues.map((queue) => queue.id);
      }

      // Get user protections for all trace fetching
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      // Build the where condition based on the scenario
      const whereCondition: any = {
        ...queueItemReferenceFilter({
          projectId: input.projectId,
          organizationId,
        }),
        doneAt:
          input.selectedAnnotations === "pending"
            ? null
            : input.selectedAnnotations === "completed"
              ? { not: null }
              : undefined,
        ...queuedAtRangeFilter(input),
      };

      if (input.queueId) {
        // Pin the requested queue to the caller's project so a queue id from
        // another tenant cannot surface its items here.
        whereCondition.AND.push({
          annotationQueue: {
            id: input.queueId,
            projectId: input.projectId,
          },
        });
      } else if (userQueueIds.length > 0) {
        // No specific queue requested: include items from the queues the caller
        // belongs to, plus items assigned directly to them.
        whereCondition.AND.push({
          OR: [
            {
              annotationQueueId: {
                in: userQueueIds,
              },
            },
            {
              userId: userId,
            },
          ],
        });
      } else {
        // Default case - just user's items
        whereCondition.userId = userId;
      }

      // Get total count for pagination
      const totalCount = await ctx.prisma.annotationQueueItem.count({
        where: whereCondition,
      });

      // Get paginated queue items first
      const queueItems = await ctx.prisma.annotationQueueItem.findMany({
        where: whereCondition,
        take: input.allQueueItems ? undefined : input.pageSize,
        skip: input.allQueueItems ? undefined : input.pageOffset,
        include: {
          user: true,
          createdByUser: true,

          annotationQueue: {
            include: {
              members: {
                where: {
                  user: {
                    orgMemberships: { some: { organizationId } },
                  },
                },
                include: {
                  user: true,
                },
              },
              AnnotationQueueScores: {
                where: { annotationScore: { projectId: input.projectId } },
                include: {
                  annotationScore: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Get unique queue IDs from the items
      const queueIds = [
        ...new Set(
          queueItems
            .map((item) => item.annotationQueueId)
            .filter((id): id is string => id !== null),
        ),
      ];

      // Get the full queue data for these queues
      const queues = await ctx.prisma.annotationQueue.findMany({
        where: {
          id: { in: queueIds },
          projectId: input.projectId,
        },
        include: {
          members: {
            where: {
              user: {
                orgMemberships: { some: { organizationId } },
              },
            },
            include: {
              user: true,
            },
          },
          AnnotationQueueScores: {
            where: { annotationScore: { projectId: input.projectId } },
            include: {
              annotationScore: true,
            },
          },
          AnnotationQueueItems: {
            where: {
              projectId: input.projectId,
              OR: [
                { userId: null },
                {
                  user: {
                    orgMemberships: { some: { organizationId } },
                  },
                },
              ],
            },
            include: {
              user: true,
              annotationQueue: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Enrich the paginated queue items with traces and annotations
      const enrichedQueueItems = await enrichQueueItemsWithTracesAndAnnotations(
        ctx,
        input.projectId,
        queueItems,
        protections,
      );

      // Create a map of enriched items by their original ID for easy lookup
      const enrichedItemMap = new Map(
        enrichedQueueItems.map((item) => [item.id, item]),
      );

      // Process queues and enrich with traces and annotations
      const processedQueues = queues.map((queue) => ({
        ...queue,
        AnnotationQueueItems: getEnrichedItems(
          queue.AnnotationQueueItems,
          enrichedItemMap,
        ),
      }));

      return {
        assignedQueueItems: enrichedQueueItems,
        queues: processedQueues,
        totalCount,
      };
    }),
});

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
  findExistingTraceIds = ({ projectId: forProject, traceIds: candidates }) =>
    ClickHouseTraceService.create({ prisma }).findExistingTraceIds({
      projectId: forProject,
      traceIds: candidates,
    }),
}: {
  traceIds: string[];
  projectId: string;
  annotators: string[];
  userId: string;
  prisma: PrismaClient;
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

  const service = AnnotationService.create({ prisma });
  await service.assertAnnotatorReferences({ projectId, queueIds, userIds });

  const queueableTraceIds = await resolveQueueableTraceIds({
    traceIds,
    projectId,
    findExistingTraceIds,
  });

  for (const traceId of queueableTraceIds) {
    for (const annotator of parsedAnnotators) {
      if (annotator.type === "queue") {
        await prisma.annotationQueueItem.upsert({
          where: {
            projectId: projectId,
            traceId_annotationQueueId_projectId: {
              traceId: traceId,
              annotationQueueId: annotator.id,
              projectId: projectId,
            },
          },
          create: {
            annotationQueueId: annotator.id,
            traceId: traceId,
            projectId: projectId,
            createdByUserId: userId,
          },
          update: {
            annotationQueueId: annotator.id,
            doneAt: null,
          },
        });
      } else {
        await prisma.annotationQueueItem.upsert({
          where: {
            projectId: projectId,
            traceId_userId_projectId: {
              traceId: traceId,
              userId: annotator.id,
              projectId: projectId,
            },
          },
          create: {
            userId: annotator.id,
            traceId: traceId,
            projectId: projectId,
            createdByUserId: userId,
          },
          update: {
            userId: annotator.id,
            doneAt: null,
          },
        });
      }
    }
  }

  return {
    created: queueableTraceIds.length,
    skipped: traceIds.length - queueableTraceIds.length,
  };
}
