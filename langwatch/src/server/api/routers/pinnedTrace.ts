import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkProjectPermission } from "../rbac";
import { getApp } from "~/server/app-layer/app";

export const pinnedTraceRouter = createTRPCRouter({
  pin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      return getApp().dataRetention.pinning.pin({
        projectId: input.projectId,
        traceId: input.traceId,
        userId: ctx.session.user.id,
        reason: input.reason,
      });
    }),

  unpin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      await getApp().dataRetention.pinning.unpin({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),

  getPin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().dataRetention.pinning.getPin({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),

  listByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().dataRetention.pinning.listByProject({
        projectId: input.projectId,
      });
    }),
});
