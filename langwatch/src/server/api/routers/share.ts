import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

import {
  checkPermissionOrPubliclyShared,
  checkProjectPermission,
  skipPermissionCheck,
} from "../rbac";

const logger = createLogger("langwatch:api:share");

export const shareRouter = createTRPCRouter({
  getShared: publicProcedure
    .input(z.object({ id: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ input, ctx }) => {
      const { id } = input;

      const share = await ctx.prisma.publicShare.findFirst({
        where: { id },
        include: {
          project: {
            select: {
              traceSharingEnabled: true,
            },
          },
        },
      });

      // If this is a trace share and trace sharing is disabled, return null
      if (
        share?.resourceType === "TRACE" &&
        !share.project.traceSharingEnabled
      ) {
        return null;
      }

      return share;
    }),

  getSharedState: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.enum(["TRACE", "THREAD"]),
        resourceId: z.string(),
      }),
    )
    .use(
      checkPermissionOrPubliclyShared(checkProjectPermission("traces:view"), {
        resourceType: (input) => input.resourceType,
        resourceParam: "resourceId",
      }),
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
      }),
    )
    .use(checkProjectPermission("traces:share"))
    .mutation(async ({ input, ctx }) => {
      const { projectId, resourceType, resourceId } = input;

      // Check if trace sharing is enabled for this project
      if (resourceType === "TRACE") {
        const project = await ctx.prisma.project.findUnique({
          where: { id: projectId },
          select: { traceSharingEnabled: true },
        });

        if (!project?.traceSharingEnabled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Trace sharing is disabled for this project",
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
      }),
    )
    .use(checkProjectPermission("traces:share"))
    .mutation(async ({ input }) => {
      const { projectId, resourceType, resourceId } = input;

      await unshareItem({ projectId, resourceType, resourceId });
    }),

  revokeAllTraceShares: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      const { projectId } = input;

      await revokeAllTraceShares(projectId);
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
  let createdShare = false;

  if (!share) {
    share = await prisma.publicShare.create({
      data: {
        projectId,
        resourceType,
        resourceId,
        userId: userId ?? null,
      },
    });
    createdShare = true;
  }

  if (resourceType === "TRACE") {
    // Auto-pin is a UI annotation; the shared trace still follows the project's retention policy.
    try {
      await getApp().dataRetention.pinning.autoPin({
        projectId,
        traceId: resourceId,
      });
    } catch (error) {
      logger.error(
        { projectId, traceId: resourceId, error },
        "Failed to auto-pin trace on share",
      );
      if (createdShare) {
        await prisma.publicShare.deleteMany({
          where: {
            projectId,
            resourceType,
            resourceId,
          },
        });
      }
      throw error;
    }
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
  // Auto-unpin first so a failure leaves the share intact (consistent with the share path's rollback).
  if (resourceType === "TRACE") {
    // Auto-pin is a UI annotation; the shared trace still follows the project's retention policy.
    try {
      await getApp().dataRetention.pinning.autoUnpin({
        projectId,
        traceId: resourceId,
      });
    } catch (error) {
      logger.error(
        { projectId, traceId: resourceId, error },
        "Failed to auto-unpin trace on unshare",
      );
      throw error;
    }
  }

  await prisma.publicShare.deleteMany({
    where: {
      projectId,
      resourceType,
      resourceId,
    },
  });
};

export const revokeAllTraceShares = async (projectId: string) => {
  await prisma.publicShare.deleteMany({
    where: {
      projectId,
      resourceType: "TRACE",
    },
  });
};
