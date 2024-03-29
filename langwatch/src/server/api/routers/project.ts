import { TRPCError } from "@trpc/server";
import slugify from "slugify";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "../../../env.mjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import {
  OrganizationRoleGroup,
  TeamRoleGroup,
  checkUserPermissionForOrganization,
  checkUserPermissionForTeam,
} from "../permission";

export const projectRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        teamId: z.string().optional(),
        newTeamName: z.string().optional(),
        name: z.string(),
        language: z.string(),
        framework: z.string(),
      })
    )
    .use(({ ctx, input, next }) => {
      if (input.teamId) {
        return checkUserPermissionForTeam(
          TeamRoleGroup.TEAM_CREATE_NEW_PROJECTS
        )({ ctx, input: { ...input, teamId: input.teamId }, next });
      } else if (input.newTeamName) {
        return checkUserPermissionForOrganization(
          OrganizationRoleGroup.ORGANIZATION_MANAGE
        )({ ctx, input, next });
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either teamId or newTeamName must be provided",
        });
      }
    })
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

      const projectNanoId = nanoid();
      const projectId = `project_${projectNanoId}`;
      const slug =
        slugify(input.name, { lower: true, strict: true }) +
        "-" +
        projectNanoId.substring(0, 6);

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

      let teamId = input.teamId;
      if (!teamId) {
        const teamName = input.newTeamName ?? input.name;
        const teamNanoId = nanoid();
        const newTeamId = `team_${teamNanoId}`;
        const teamSlug =
          slugify(teamName, { lower: true, strict: true }) +
          "-" +
          newTeamId.substring(0, 6);
        const team = await prisma.team.create({
          data: {
            id: newTeamId,
            name: teamName,
            slug: teamSlug,
            organizationId: input.organizationId,
          },
        });
        await prisma.teamUser.create({
          data: {
            userId: userId,
            teamId: team.id,
            role: "ADMIN",
          },
        });

        teamId = team.id;
      }

      const project = await prisma.project.create({
        data: {
          id: projectId,
          name: input.name,
          slug,
          language: input.language,
          framework: input.framework,
          teamId: teamId,
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
