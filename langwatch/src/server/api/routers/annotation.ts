import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

import { PublicShareResourceTypes } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
import { getTracesWithSpans } from "./traces";
import { getUserProtectionsForProject } from "../utils";
import { createLogger } from "../../../utils/logger";
import { TRACE_INDEX, esClient, traceIndexId } from "~/server/elasticsearch";
const scoreOptionSchema = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  reason: z.string().optional().nullable(),
});

const logger = createLogger("langwatch:api:annotation");

const scoreOptions = z.record(z.string(), scoreOptionSchema);

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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      logger.info({ input }, "create annotation");

      const createdAnnotation = await ctx.prisma.$transaction(async (tx) => {
        const annotation = await tx.annotation.create({
          data: {
            id: nanoid(),
            projectId: input.projectId,
            comment: input.comment ?? "",
            isThumbsUp: input.isThumbsUp ?? null,
            traceId: input.traceId,
            userId: ctx.session.user.id,
            scoreOptions: input.scoreOptions ?? {},
            expectedOutput: input.expectedOutput ?? null,
          },
        });

        try {
          await updateTraceWithAnnotation(input.traceId, input.projectId);
        } catch (error) {
          logger.error(
            { error, traceId: input.traceId, projectId: input.projectId },
            "Failed to update Elasticsearch after annotation creation"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to add annotation to trace.",
            cause: error,
          });
        }

        return annotation;
      });

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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
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
      })
    )
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        }
      )
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const deletedAnnotation = await ctx.prisma.$transaction(async (tx) => {
        const annotation = await tx.annotation.delete({
          where: {
            id: input.annotationId,
            projectId: input.projectId,
          },
        });

        try {
          await updateTraceRemoveAnnotation(
            annotation.traceId,
            input.projectId
          );
        } catch (error) {
          // If Elasticsearch update fails, we should fail the transaction
          // to maintain consistency between database and Elasticsearch
          logger.error(
            { error, traceId: annotation.traceId, projectId: input.projectId },
            "Failed to update Elasticsearch after annotation deletion"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete annotation from trace.",
            cause: error,
          });
        }

        return annotation;
      });

      return deletedAnnotation;
    }),
  getAll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name.replace("_", "-"), {
        lower: true,
        strict: true,
      });

      if (slug == "all" || slug == "me" || slug == "my-queue") {
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
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      const queues = await ctx.prisma.annotationQueue.findMany({
        where: { projectId: input.projectId },
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
              createdByUser: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const traceIds = [
        ...new Set(
          queues.flatMap((queue) =>
            queue.AnnotationQueueItems.map((item) => item.traceId)
          )
        ),
      ];

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const traces = await getTracesWithSpans(
        input.projectId,
        traceIds,
        protections
      );
      const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

      return queues.map((queue) => ({
        ...queue,
        AnnotationQueueItems: queue.AnnotationQueueItems.map((item) => ({
          ...item,
          trace: traceMap.get(item.traceId) || null,
        })),
      }));
    }),
  getQueueItems: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      const queueItems = await ctx.prisma.annotationQueueItem.findMany({
        where: { projectId: input.projectId },
        include: {
          annotationQueue: {
            include: {
              members: true,
            },
          },
          createdByUser: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const traceIds = [...new Set(queueItems.map((item) => item.traceId))];
      const traces = await getTracesWithSpans(
        input.projectId,
        traceIds,
        protections
      );
      const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

      return queueItems.map((item) => ({
        ...item,
        trace: traceMap.get(item.traceId) || null,
      }));
    }),
  getPendingItemsCount: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
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
  createQueueItem: protectedProcedure
    .input(
      z.object({
        traceIds: z.array(z.string()),
        projectId: z.string(),
        annotators: z.array(z.string()),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
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
});

const updateTraceWithAnnotation = async (
  traceId: string,
  projectId: string
) => {
  const client = await esClient({ projectId });
  await client.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({
      traceId: traceId,
      projectId: projectId,
    }),
    retry_on_conflict: 10,
    body: {
      script: {
        source: `
          try {
            if (!ctx._source.containsKey('annotations')) {
              ctx._source.annotations = [
                'count': 1,
                'hasAnnotation': true
              ];
            } else if (ctx._source.annotations.containsKey('count')) {
              ctx._source.annotations.count += 1;
            } else {
              ctx._source.annotations.count = 1;
            }
            ctx._source.annotations.hasAnnotation = true;
          } catch (Exception e) {
            // If anything goes wrong, ensure we have a valid annotations object
            ctx._source.annotations = [
              'count': 1,
              'hasAnnotation': true
            ];
          }
        `,
        lang: "painless",
      },
    },
  });
};

const updateTraceRemoveAnnotation = async (
  traceId: string,
  projectId: string
) => {
  const client = await esClient({ projectId });
  await client.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({
      traceId: traceId,
      projectId: projectId,
    }),
    retry_on_conflict: 10,
    body: {
      script: {
        source: `
          try {
            if (ctx._source.containsKey('annotations') && ctx._source.annotations.containsKey('count')) {
              ctx._source.annotations.count -= 1;
              if (ctx._source.annotations.count <= 0) {
                ctx._source.remove('annotations');
              } else {
                ctx._source.annotations.hasAnnotation = true;
              }
            }
          } catch (Exception e) {
            // If anything goes wrong, remove the annotations object
            ctx._source.remove('annotations');
          }
        `,
        lang: "painless",
      },
    },
  });
};

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
