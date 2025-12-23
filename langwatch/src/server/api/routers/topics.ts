import { z } from "zod";
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
});
