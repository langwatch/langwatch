import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PinnedToActiveShareError } from "@langwatch/share-contract";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const pinnedTraceRouter = createTRPCRouter({
  pin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .permission("project:update")
    .mutation(async ({ input, ctx }) => {
      return ctx.app.dataRetention.pin({
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
    .permission("project:update")
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.app.share.unpinTrace({
          projectId: input.projectId,
          traceId: input.traceId,
        });
      } catch (error) {
        // Surfaces as a non-toast inline error in the UI (the PinButton also
        // disables itself when source=share + share active, but we never
        // trust the client; the route is the authoritative gate).
        if (error instanceof PinnedToActiveShareError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),

  getPin: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceId: z.string(),
      }),
    )
    .permission("traces:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.dataRetention.tryGetPin({
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
    .permission("traces:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.dataRetention.listByProject({
        projectId: input.projectId,
      });
    }),
});
