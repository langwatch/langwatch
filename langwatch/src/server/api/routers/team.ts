import { TRPCError } from "@trpc/server";
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
  getTeamsWithMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const teams = await prisma.team.findMany({
        where: {
          organizationId: input.organizationId,
          members: {
            some: {
              userId: userId,
            },
          },
        },
        include: {
          members: true,
          projects: true,
        },
      });

      return teams;
    }),
  getTeamWithMembers: protectedProcedure
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
        include: {
          members: true,
          projects: true,
        },
      });

      return team;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const teamUser = await prisma.teamUser.findFirst({
        where: {
          userId: userId,
          teamId: input.id,
          role: "ADMIN",
        },
      });

      if (!teamUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have the necessary permissions",
        });
      }

      await prisma.team.update({
        where: {
          id: input.id,
        },
        data: {
          name: input.name,
        },
      });

      return { success: true };
    }),
});
