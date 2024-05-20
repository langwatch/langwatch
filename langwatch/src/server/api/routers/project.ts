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
  checkUserPermissionForProject,
  checkUserPermissionForTeam,
  skipPermissionCheck,
} from "../permission";
import { getOrganizationProjectsCount } from "./limits";
import { dependencies } from "../../../injection/dependencies.server";

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
    .use(skipPermissionCheck)
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

      const projectCount = await getOrganizationProjectsCount(
        input.organizationId
      );
      const activePlan = await dependencies.subscriptionHandler.getActivePlan(
        input.organizationId,
        ctx.session.user
      );

      if (projectCount >= activePlan.maxProjects && !activePlan.overrideAddingLimitations) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You have reached the maximum number of projects",
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
  getProjectAPIKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { apiKey: true },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return project;
    }),
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        language: z.string(),
        framework: z.string(),
        piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL"]),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: {
          name: input.name,
          language: input.language,
          framework: input.framework,
          piiRedactionLevel: input.piiRedactionLevel,
        },
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
});

const generateApiKey = (): string => {
  const payload = {
    timestamp: Date.now(),
    rand: Math.random(),
  };

  return jwt.sign(payload, env.API_TOKEN_JWT_SECRET);
};
