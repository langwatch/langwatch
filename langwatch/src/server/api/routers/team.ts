import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const team = await prisma.team.findFirst({
        where: {
          slug: input.slug,
          members: {
            some: {
              userId: userId,
            },
          },
        },
      });

      return team;
    }),
});
