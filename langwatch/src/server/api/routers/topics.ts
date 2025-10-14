import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { checkProjectPermission } from "../rbac";

export const topicsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("messages:view"))
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
});
