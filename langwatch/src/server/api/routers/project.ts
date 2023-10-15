import { TRPCError } from "@trpc/server";
import slugify from "slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "../../../env.mjs";
import jwt from "jsonwebtoken";

export const projectRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        techStack: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;

      const teamUser = await prisma.teamUser.findFirst({
        where: {
          userId: userId,
          teamId: input.teamId,
          role: "ADMIN",
        },
      });

      if (!teamUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have the necessary permissions",
        });
      }

      const slug = slugify(input.name, { lower: true, strict: true });

      const existingProject = await prisma.project.findFirst({
        where: {
          teamId: input.teamId,
          slug,
        },
      });

      if (existingProject) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A project with this name already exists in the selected team.",
        });
      }

      const project = await prisma.project.create({
        data: {
          name: input.name,
          slug,
          techStack: input.techStack,
          teamId: input.teamId,
          apiKey: generateApiKey(),
        },
      });

      return { success: true, projectId: project.id };
    }),
});

const generateApiKey = (): string => {
  const payload = {
    timestamp: Date.now(),
    rand: Math.random(),
  };

  return jwt.sign(payload, env.API_TOKEN_JWT_SECRET);
};
