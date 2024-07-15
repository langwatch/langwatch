import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

import {
  TeamRoleGroup,
  checkUserPermissionForProject,
  skipPermissionCheck,
} from "../permission";

export const shareRouter = createTRPCRouter({
  getShared: publicProcedure
    .input(z.object({ id: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ input, ctx }) => {
      const { id } = input;

      const share = await ctx.prisma.publicShare.findFirst({
        where: { id },
      });

      return share;
    }),

  getSharedState: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.enum(["TRACE", "THREAD"]),
        resourceId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId, resourceType, resourceId } = input;

      const share = await ctx.prisma.publicShare.findFirst({
        where: {
          projectId,
          resourceType,
          resourceId,
        },
      });

      return share;
    }),

  shareItem: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.enum(["TRACE", "THREAD"]),
        resourceId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_SHARE))
    .mutation(async ({ input, ctx }) => {
      console.log("input", input);
      const { projectId, resourceType, resourceId } = input;

      let share = await ctx.prisma.publicShare.findFirst({
        where: {
          projectId,
          resourceType,
          resourceId,
        },
      });

      if (!share) {
        share = await ctx.prisma.publicShare.create({
          data: {
            projectId,
            resourceType,
            resourceId,
            userId: ctx.session.user.id,
          },
        });
      }

      return share;
    }),

  unshareItem: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.enum(["TRACE", "THREAD"]),
        resourceId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_SHARE))
    .mutation(async ({ input, ctx }) => {
      const { projectId, resourceType, resourceId } = input;

      await ctx.prisma.publicShare.deleteMany({
        where: {
          projectId,
          resourceType,
          resourceId,
        },
      });
    }),
});
