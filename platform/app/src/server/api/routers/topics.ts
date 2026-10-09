import { z } from "zod";
import { getApp } from "../../app-layer/app";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const topicsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("traces:view")
    .query(async ({ input }) => {
      // The projected topic model is the source of truth; read it through
      // the topic-clustering service, never straight at the table.
      return await getApp().topicClustering.topics.getAll({
        projectId: input.projectId,
      });
    }),

  getClusteringStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input }) => {
      return await getApp().topicClustering.status.getByProjectId({
        projectId: input.projectId,
      });
    }),

  getClusteringRunHistory: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input }) => {
      return await getApp().topicClustering.status.getRunHistoryByProjectId({
        projectId: input.projectId,
      });
    }),
});
