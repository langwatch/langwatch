import { z } from "zod";
import { PrismaTopicClusteringStatusRepository } from "../../app-layer/topic-clustering/repositories/topic-clustering-status.repository";
import { TopicClusteringStatusService } from "../../app-layer/topic-clustering/topic-clustering-status.service";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const topicsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const topics = await prisma.topic.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          parentId: true,
          automaticallyGenerated: true,
        },
      });

      return topics;
    }),

  getClusteringStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const service = new TopicClusteringStatusService(
        new PrismaTopicClusteringStatusRepository(ctx.prisma),
      );
      return await service.getByProjectId({ projectId: input.projectId });
    }),
});
