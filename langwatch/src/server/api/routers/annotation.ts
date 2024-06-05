import { type DatabaseSchema } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const annotationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        comment: z.string().optional().nullable(),
        isThumbsUp: z.boolean().optional().nullable(),
        traceId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      console.log(input);
      return ctx.prisma.annotation.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          comment: input.comment ?? "",
          isThumbsUp: input.isThumbsUp ?? false,
          traceId: input.traceId,
          userId: ctx.session.user.id,
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotation.update({
        where: {
          id: input.id,
          projectId: input.projectId,
          traceId: input.traceId,
        },
        data: {
          comment: input.comment ?? "",
          isThumbsUp: input.isThumbsUp ?? false,
        },
      });
    }),
  getByTraceId: protectedProcedure
    .input(
      z.object({
        traceId: z.string(),
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
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
  getById: protectedProcedure
    .input(z.object({ annotationId: z.string(), projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotation.delete({
        where: {
          id: input.annotationId,
          projectId: input.projectId,
        },
      });
    }),
});
