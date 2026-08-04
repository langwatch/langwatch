import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { traceEditOverlayPatchSchema } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Reviewer corrections for a trace.
 *
 * Reading one needs permission to view traces; writing one needs permission to
 * update annotations. Correcting a trace is review work, and external reviewers
 * hold annotation permissions rather than trace ones, which is the same family
 * the suggest-an-output flow already sits in.
 */
export const traceEditOverlayRouter = createTRPCRouter({
  getByTraceId: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().traces.editOverlay.getByTraceId({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        patch: traceEditOverlayPatchSchema,
      }),
    )
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ ctx, input }) => {
      return getApp().traces.editOverlay.upsert({
        projectId: input.projectId,
        traceId: input.traceId,
        patch: input.patch,
        userId: ctx.session.user.id,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkProjectPermission("annotations:update"))
    .mutation(async ({ input }) => {
      await getApp().traces.editOverlay.delete({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    }),
});
