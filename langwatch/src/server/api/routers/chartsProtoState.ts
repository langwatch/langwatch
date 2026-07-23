import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * PROTOTYPE (#5670 S1) -- server-side persistence for the charts-proto
 * query-builder dashboard's own composition state (name + widget list).
 *
 * Deliberately isolated from the real Dashboard/CustomGraph tables -- see the
 * ChartsPrototypeState model's doc-comment in schema.prisma for why. The
 * `widgets` shape (WidgetSpec[] from model.ts) is intentionally NOT mirrored
 * here as a strict zod schema: it is prototype-owned, client-generated state
 * written back by the same authenticated user who owns the project, not
 * external input crossing a trust boundary.
 */
const widgetShape = z.record(z.string(), z.unknown());

export const chartsProtoStateRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ ctx, input }) => {
      const state = await ctx.prisma.chartsPrototypeState.findUnique({
        where: { projectId: input.projectId },
      });
      return {
        name: state?.name ?? "Untitled dashboard",
        widgets: (state?.widgets as Record<string, unknown>[]) ?? [],
      };
    }),

  save: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        widgets: z.array(widgetShape),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      const widgets = input.widgets as unknown as Prisma.InputJsonValue;
      await ctx.prisma.chartsPrototypeState.upsert({
        where: { projectId: input.projectId },
        create: {
          projectId: input.projectId,
          name: input.name,
          widgets,
        },
        update: {
          name: input.name,
          widgets,
        },
      });
      return { success: true };
    }),
});
