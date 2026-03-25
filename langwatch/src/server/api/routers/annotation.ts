import {
  type AnnotationQueueItem,
  type PrismaClient,
  PublicShareResourceTypes,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import type { Session } from "next-auth";
import { z } from "zod";
import { AnnotationService } from "~/server/annotations/annotation.service";
import { TraceService } from "~/server/traces/trace.service";
import { slugify } from "~/utils/slugify";
import type { Protections } from "../../elasticsearch/protections";
import { checkPermissionOrPubliclyShared } from "../rbac";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

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

  // Get all annotations for these traces in a single query
  const annotations = await ctx.prisma.annotation.findMany({
    where: {
      projectId: projectId,
      traceId: {
        in: traceIds,
      },
    },
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Get traces for queue items
  const traceService = TraceService.create(ctx.prisma);
  const traces = await traceService.getTracesWithSpans(
    projectId,
    traceIds,
    protections,
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

export const annotationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        comment: z.string().optional().nullable(),
        isThumbsUp: z.boolean().optional().nullable(),
        traceId: z.string(),
        scoreOptions: scoreOptions,
        expectedOutput: z.string().optional().nullable(),
      }),
    )
    .use(checkProjectPermission("annotations:create"))
    .mutation(async ({ ctx, input }) => {
      const service = await AnnotationService.create({
        prisma: ctx.prisma,
        projectId: input.projectId,
      });

      return service.create({
        id: nanoid(),
        projectId: input.projectId,
        traceId: input.traceId,
        userId: ctx.session.user.id,
        comment: input.comment ?? "",
        isThumbsUp: input.isThumbsUp ?? null,
        scoreOptions: input.scoreOptions ?? {},
        expectedOutput: input.expectedOutput ?? null,
      });
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
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotation.update({
        where: {
          id: input.id,
          projectId: input.projectId,
          traceId: input.traceId,
        },
        data: {
          comment: input.comment ?? "",
          isThumbsUp: input.isThumbsUp,
          scoreOptions: input.scoreOptions ?? {},
          expectedOutput: input.expectedOutput ?? null,
        },
      });
    }),
  getByTraceId: publicProcedure
    .input(
      z.object({
        traceId: z.string(),
        projectId: z.string(),
      }),
    )
    .use(
      checkPermissionOrPubliclyShared(
        checkProjectPermission("annotations:view"),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        },
      ),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotation.findMany({
        where: {
          traceId: input.traceId,
          projectId: input.projectId,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });
    }),
  getByTraceIds: protectedProcedure
    .input(
      z.object({
        traceIds: z.array(z.string()),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotation.findMany({
        where: {
          traceId: {
            in: input.traceIds,
          },
          projectId: input.projectId,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });
    }),
  getById: protectedProcedure
    .input(z.object({ annotationId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("annotations:view"))
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
    .use(checkProjectPermission("annotations:delete"))
    .mutation(async ({ ctx, input }) => {
      const service = await AnnotationService.create({
        prisma: ctx.prisma,
        projectId: input.projectId,
      });

      return service.delete({
        id: input.annotationId,
        projectId: input.projectId,
      });
    }),
  getAll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotation.findMany({
        where: {
          projectId: input.projectId,
          createdAt: {
            gte: input.startDate,
            lte: input.endDate,
          },
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
    .use(checkProjectPermission("annotations:create"))
    .mutation(async ({ ctx, input }) => {
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
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueue.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
  getQueueItems: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      const queueItems = await ctx.prisma.annotationQueueItem.findMany({
        where: { projectId: input.projectId },
        include: {
          user: true,
          createdByUser: true,
          annotationQueue: {
            include: {
              members: true,
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
      const traceService = TraceService.create(ctx.prisma);
      const traces = await traceService.getTracesWithSpans(
        input.projectId,
        traceIds,
        protections,
      );
      const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

      return queueItems.map((item) => ({
        ...item,
        trace: traceMap.get(item.traceId) ?? null,
      }));
    }),
  getPendingItemsCount: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("annotations:view"))
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
    .use(checkProjectPermission("annotations:view"))
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
    .use(checkProjectPermission("annotations:view"))
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
    .use(checkProjectPermission("annotations:create"))
    .mutation(async ({ ctx, input }) => {
      await createOrUpdateQueueItems({
        traceIds: input.traceIds,
        projectId: input.projectId,
        annotators: input.annotators,
        userId: ctx.session.user.id,
        prisma: ctx.prisma,
      });
    }),
  markQueueItemDone: protectedProcedure
    .input(z.object({ queueItemId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueueItem.update({
        where: { id: input.queueItemId, projectId: input.projectId },
        data: {
          doneAt: new Date(),
        },
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
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueue.findUnique({
        where: input.queueId
          ? { id: input.queueId, projectId: input.projectId }
          : {
              projectId_slug: { projectId: input.projectId, slug: input.slug! },
            },
        include: {
          members: {
            include: {
              user: true,
            },
          },
          AnnotationQueueScores: {
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
      }),
    )
    .use(checkProjectPermission("annotations:view"))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
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
        projectId: input.projectId,
        doneAt:
          input.selectedAnnotations === "pending"
            ? null
            : input.selectedAnnotations === "completed"
              ? { not: null }
              : undefined,
      };

      if (input.queueId) {
        // Specific queue selected - only filter by annotationQueueId
        whereCondition.annotationQueueId = input.queueId;
      } else if (userQueueIds.length > 0) {
        // All annotations - check if annotationQueueId is in user's queue IDs
        whereCondition.OR = [
          {
            annotationQueueId: {
              in: userQueueIds,
            },
          },
          {
            userId: userId,
          },
        ];
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
                include: {
                  user: true,
                },
              },
              AnnotationQueueScores: {
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
            include: {
              user: true,
            },
          },
          AnnotationQueueScores: {
            include: {
              annotationScore: true,
            },
          },
          AnnotationQueueItems: {
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

export async function createOrUpdateQueueItems({
  traceIds,
  projectId,
  annotators,
  userId,
  prisma,
}: {
  traceIds: string[];
  projectId: string;
  annotators: string[];
  userId: string;
  prisma: any;
}) {
  for (const traceId of traceIds) {
    for (const annotator of annotators) {
      if (annotator.startsWith("queue")) {
        await prisma.annotationQueueItem.upsert({
          where: {
            projectId: projectId,
            traceId_annotationQueueId_projectId: {
              traceId: traceId,
              annotationQueueId: annotator.replace("queue-", ""),
              projectId: projectId,
            },
          },
          create: {
            annotationQueueId: annotator.replace("queue-", ""),
            traceId: traceId,
            projectId: projectId,
            createdByUserId: userId,
          },
          update: {
            annotationQueueId: annotator.replace("queue-", ""),
            doneAt: null,
          },
        });
      } else {
        await prisma.annotationQueueItem.upsert({
          where: {
            projectId: projectId,
            traceId_userId_projectId: {
              traceId: traceId,
              userId: annotator.replace("user-", ""),
              projectId: projectId,
            },
          },
          create: {
            userId: annotator.replace("user-", ""),
            traceId: traceId,
            projectId: projectId,
            createdByUserId: userId,
          },
          update: {
            userId: annotator.replace("user-", ""),
            doneAt: null,
          },
        });
      }
    }
  }
}
