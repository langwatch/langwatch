import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { assertProjectAcceptsWrites } from "~/server/app-layer/projects/project-write-guard";
import { PinnedToActiveShareError } from "~/server/data-retention/pinning/pinnedTrace.service";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Refuses a pin write on an aggregate project (ADR-144 decision 8). Pinning
 * writes a row under the project it names, but is declared under
 * `project:update`, a resource the permission-level guard exempts so an admin
 * can still manage the aggregate itself; so each write asks the guard here.
 */
const refuseOnAggregate = (projectId: string) =>
  assertProjectAcceptsWrites({ kinds: getApp().projectKinds, projectId });

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
      await refuseOnAggregate(input.projectId);
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
    .permission("project:update")
    .mutation(async ({ input }) => {
      await refuseOnAggregate(input.projectId);
      try {
        await getApp().dataRetention.pinning.unpin({
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
    .permission("traces:view")
    .query(async ({ input }) => {
      return getApp().dataRetention.pinning.listByProject({
        projectId: input.projectId,
      });
    }),
});
