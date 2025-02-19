import { TRPCError } from "@trpc/server";
import slugify from "slugify";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { env } from "../../../env.mjs";
import { customAlphabet, nanoid } from "nanoid";
import {
  OrganizationRoleGroup,
  TeamRoleGroup,
  checkUserPermissionForOrganization,
  checkUserPermissionForProject,
  checkUserPermissionForTeam,
  skipPermissionCheck,
  skipPermissionCheckProjectCreation,
} from "../permission";
import { getOrganizationProjectsCount } from "./limits";
import { dependencies } from "../../../injection/dependencies.server";
import { allowedTopicClusteringModels } from "../../topicClustering/types";
import type { Project } from "@prisma/client";

export const projectRouter = createTRPCRouter({
  publicGetById: publicProcedure
    .input(z.object({ id: z.string(), shareId: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const publicShare = await prisma.publicShare.findUnique({
        where: { id: input.shareId, projectId: input.id },
      });

      if (!publicShare) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Public share not found",
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        language: project.language,
        framework: project.framework,
        firstMessage: true,
        topicClusteringModel: null,
        apiKey: "",
        teamId: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        piiRedactionLevel: "STRICT",
      } as Project;
    }),
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
    .use(skipPermissionCheckProjectCreation)
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

      if (
        projectCount >= activePlan.maxProjects &&
        !activePlan.overrideAddingLimitations
      ) {
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
          piiRedactionLevel:
            env.NODE_ENV === "development" || !env.IS_SAAS
              ? "DISABLED"
              : "ESSENTIAL",
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
        piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]),
        userLinkTemplate: z.string().optional(),
        s3Endpoint: z.string().optional(),
        s3AccessKeyId: z.string().optional(),
        s3SecretAccessKey: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        include: { team: { include: { organization: true } } },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      if (
        input.piiRedactionLevel === "DISABLED" &&
        !(
          env.NODE_ENV === "development" ||
          !env.IS_SAAS ||
          project.team.organization.signedDPA
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "PII redation cannot be disabled",
        });
      }

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: {
          name: input.name,
          language: input.language,
          framework: input.framework,
          piiRedactionLevel: input.piiRedactionLevel,
          userLinkTemplate: input.userLinkTemplate,
          s3Endpoint: input.s3Endpoint,
          s3AccessKeyId: input.s3AccessKeyId,
          s3SecretAccessKey: input.s3SecretAccessKey,
        },
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
  updateEmbeddingsModel: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        embeddingsModel: z.string(),
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
          embeddingsModel: input.embeddingsModel,
        },
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
  updateTopicClusteringModel: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        topicClusteringModel: z.enum(allowedTopicClusteringModels as any),
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
          topicClusteringModel: input.topicClusteringModel,
        },
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
});

const generateApiKey = (): string => {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const randomPart = customAlphabet(alphabet, 48)();
  return `sk-lw-${randomPart}`;
};
