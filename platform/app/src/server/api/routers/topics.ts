import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const topicsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("traces:view")
    .query(async ({ input, ctx }) => {
      return await ctx.app.topics.getAll({
        projectId: input.projectId,
      });
    }),

  getClusteringStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return await ctx.app.topics.getClusteringStatus({
        projectId: input.projectId,
      });
    }),

  getClusteringRunHistory: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return await ctx.app.topics.getClusteringRunHistory({
        projectId: input.projectId,
      });
    }),
});
