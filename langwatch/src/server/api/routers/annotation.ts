import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

import { PublicShareResourceTypes } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import slugify from "slugify";
import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
const scoreOptionSchema = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  reason: z.string().optional().nullable(),
});

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
      console.log(input);
      return ctx.prisma.annotation.create({
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
      return ctx.prisma.annotation.delete({
        where: {
          id: input.annotationId,
          projectId: input.projectId,
        },
      });
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
      return ctx.prisma.annotationQueue.findMany({
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
    }),
  getQueueItems: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueueItem.findMany({
        where: { projectId: input.projectId },
        include: {
          annotationQueue: true,
          createdByUser: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),
  getDoneQueueItems: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationQueueItem.findMany({
        where: { projectId: input.projectId, doneAt: { not: null } },
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
