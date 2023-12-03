import { TRPCError } from "@trpc/server";
import slugify from "slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "../../../env.mjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";

export const projectRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        language: z.string(),
        framework: z.string(),
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

      const projectId = `project_${nanoid()}`;
      const slug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        projectId.substring(0, 6);

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
          id: projectId,
          name: input.name,
          slug,
          language: input.language,
          framework: input.framework,
          teamId: input.teamId,
          apiKey: generateApiKey(),
        },
      });

      return { success: true, projectSlug: project.slug };
    }),
});

const generateApiKey = (): string => {
  const payload = {
    timestamp: Date.now(),
    rand: Math.random(),
  };

  return jwt.sign(payload, env.API_TOKEN_JWT_SECRET);
};
