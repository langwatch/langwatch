import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

import { getApp } from "~/server/app-layer/app";

import {
  checkPermissionOrPubliclyShared,
  checkProjectPermission,
  skipPermissionCheck,
} from "../rbac";

export const shareRouter = createTRPCRouter({
  getShared: publicProcedure
    .input(z.object({ id: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ input }) => {
      return getApp().share.getById(input.id);
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
    .query(async ({ input }) => {
      return getApp().share.getStateForResource({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      });
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

      if (resourceType === "TRACE") {
        const project = await getApp().projects.getById(projectId);
        if (!project?.traceSharingEnabled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Trace sharing is disabled for this project",
          });
        }
      }

      return getApp().share.createShare({
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
      await getApp().share.unshare(input);
    }),

  revokeAllTraceShares: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      await getApp().share.revokeAllTraceShares(input.projectId);
    }),
});
