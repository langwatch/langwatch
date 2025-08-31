import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

import { prisma } from "~/server/db";

import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
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

  getSharedState: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.enum(["TRACE", "THREAD"]),
        resourceId: z.string(),
      })
    )
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW),
        {
          resourceType: (input) => input.resourceType,
          resourceParam: "resourceId",
        }
      )
    )
    .query(async ({ input, ctx }) => {
      const { resourceType, resourceId } = input;

      const share = await ctx.prisma.publicShare.findFirst({
        where: {
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
      const { projectId, resourceType, resourceId } = input;

      // Check if trace sharing is disabled for this project
      if (resourceType === "TRACE") {
        const project = await ctx.prisma.project.findUnique({
          where: { id: projectId },
          select: { traceSharingDisabled: true },
        });

        if (project?.traceSharingDisabled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Trace sharing has been disabled for this project",
          });
        }
      }

      return createShare({
        projectId,
        resourceType,
        resourceId,
        userId: ctx.session.user.id,
      });
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
    .mutation(async ({ input }) => {
      const { projectId, resourceType, resourceId } = input;

      await unshareItem({ projectId, resourceType, resourceId });
    }),
});

export const createShare = async ({
  projectId,
  resourceType,
  resourceId,
  userId,
}: {
  projectId: string;
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
  userId?: string | null;
}) => {
  let share = await prisma.publicShare.findFirst({
    where: {
      projectId,
      resourceType,
      resourceId,
    },
  });

  if (!share) {
    share = await prisma.publicShare.create({
      data: {
        projectId,
        resourceType,
        resourceId,
        userId: userId ?? null,
      },
    });
  }

  return share;
};

export const unshareItem = async ({
  projectId,
  resourceType,
  resourceId,
}: {
  projectId: string;
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
}) => {
  await prisma.publicShare.deleteMany({
    where: {
      projectId,
      resourceType,
      resourceId,
    },
  });
};
