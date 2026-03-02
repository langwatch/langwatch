import {
  Prisma,
  type PrismaClient,
  type Project,
  ProjectSensitiveDataVisibilityLevel,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import type { Session } from "next-auth";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getApp } from "~/server/app-layer";
import { encrypt } from "~/utils/encryption";
import { slugify } from "~/utils/slugify";
import { auditLog } from "../../auditLog";
import { generateApiKey } from "../../utils/apiKeyGenerator";
import {
  checkOrganizationPermission,
  checkProjectPermission,
  checkTeamPermission,
  hasProjectPermission,
  skipPermissionCheck,
  skipPermissionCheckProjectCreation,
} from "../rbac";
import { getOrganizationProjectsCount } from "./limits";
import { revokeAllTraceShares } from "./share";

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
      }),
    )
    .use(skipPermissionCheckProjectCreation)
    .use(({ ctx, input, next }) => {
      if (input.teamId) {
        return checkTeamPermission("organization:manage")({
          ctx,
          input: { ...input, teamId: input.teamId },
          next,
        });
      } else if (input.newTeamName) {
        return checkOrganizationPermission("organization:manage")({
          ctx,
          input,
          next,
        });
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
        input.organizationId,
      );
      const activePlan = await getApp().planProvider.getActivePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
      });

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
          capturedInputVisibility:
            ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
          capturedOutputVisibility:
            ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
          featureClickHouseDataSourceSimulations: Boolean(env.IS_SAAS),
          featureClickHouseDataSourceEvaluations: Boolean(env.IS_SAAS),
          featureClickHouseDataSourceTraces: Boolean(env.IS_SAAS),
          featureEventSourcingSimulationIngestion: Boolean(env.IS_SAAS),
          featureEventSourcingEvaluationIngestion: Boolean(env.IS_SAAS),
          featureEventSourcingTraceIngestion: Boolean(env.IS_SAAS),
        },
      });

      return { success: true, projectSlug: project.slug };
    }),
  getProjectAPIKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
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
  regenerateApiKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Generate new API key
      const newApiKey = generateApiKey();

      try {
        // Update the project with new API key
        // Note: updatedAt is handled automatically by Prisma @updatedAt
        const project = await prisma.project.update({
          where: { id: input.projectId },
          data: {
            apiKey: newApiKey,
          },
          select: {
            apiKey: true,
            id: true,
            slug: true,
          },
        });

        // Audit log the security-critical action
        await auditLog({
          action: "project.apiKey.regenerated",
          userId: ctx.session.user.id,
          projectId: input.projectId,
        });

        return { apiKey: project.apiKey };
      } catch (error) {
        // Prisma throws P2025 when no record is found
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        throw error;
      }
    }),
  update: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          name: z.string(),
          language: z.string(),
          framework: z.string(),
          piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]),
          capturedInputVisibility: z
            .enum(["REDACTED_TO_ALL", "VISIBLE_TO_ADMIN", "VISIBLE_TO_ALL"])
            .optional(),
          capturedOutputVisibility: z
            .enum(["REDACTED_TO_ALL", "VISIBLE_TO_ADMIN", "VISIBLE_TO_ALL"])
            .optional(),
          traceSharingEnabled: z.boolean().optional(),
          userLinkTemplate: z.string().optional(),
          s3Endpoint: z.string().optional(),
          s3AccessKeyId: z.string().optional(),
          s3SecretAccessKey: z.string().optional(),
          s3Bucket: z.string().optional(),
        })
        .refine((data) => {
          const hasEndpoint = !!data.s3Endpoint?.trim();
          const hasAccessKey = !!data.s3AccessKeyId?.trim();
          const hasSecretKey = !!data.s3SecretAccessKey?.trim();

          return (
            (hasEndpoint && hasAccessKey && hasSecretKey) ||
            (!hasEndpoint && !hasAccessKey && !hasSecretKey)
          );
        }),
    )
    .use(checkProjectPermission("project:update"))
    .use(checkCapturedDataVisibilityPermission)
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
          capturedInputVisibility:
            input.capturedInputVisibility ?? project.capturedInputVisibility,
          capturedOutputVisibility:
            input.capturedOutputVisibility ?? project.capturedOutputVisibility,
          traceSharingEnabled:
            input.traceSharingEnabled ?? project.traceSharingEnabled,
          s3Endpoint: input.s3Endpoint ? encrypt(input.s3Endpoint) : null,
          s3AccessKeyId: input.s3AccessKeyId
            ? encrypt(input.s3AccessKeyId)
            : null,
          s3SecretAccessKey: input.s3SecretAccessKey
            ? encrypt(input.s3SecretAccessKey)
            : null,
          s3Bucket: input.s3Bucket,
        },
      });

      // If trace sharing was disabled, revoke all existing trace shares
      if (
        input.traceSharingEnabled === false &&
        project.traceSharingEnabled === true
      ) {
        await revokeAllTraceShares(input.projectId);
      }

      return { success: true, projectSlug: updatedProject.slug };
    }),
  updateEmbeddingsModel: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        embeddingsModel: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
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
        topicClusteringModel: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
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
  updateDefaultModel: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        defaultModel: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
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
          defaultModel: input.defaultModel,
        },
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
  updateProjectDefaultModels: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        defaultModel: z.string().optional(),
        topicClusteringModel: z.string().optional(),
        embeddingsModel: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
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

      // Build update data only for provided fields
      const updateData: {
        defaultModel?: string;
        topicClusteringModel?: string;
        embeddingsModel?: string;
      } = {};

      if (input.defaultModel !== undefined) {
        updateData.defaultModel = input.defaultModel;
      }
      if (input.topicClusteringModel !== undefined) {
        updateData.topicClusteringModel = input.topicClusteringModel;
      }
      if (input.embeddingsModel !== undefined) {
        updateData.embeddingsModel = input.embeddingsModel;
      }

      // Skip update if no fields to update
      if (Object.keys(updateData).length === 0) {
        return { success: true, projectSlug: project.slug };
      }

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: updateData,
      });

      return { success: true, projectSlug: updatedProject.slug };
    }),
  getFieldRedactionStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(
      async ({
        input,
        ctx,
      }: {
        input: { projectId: string };
        ctx: { session: Session; prisma: PrismaClient };
      }) => {
        const { projectId } = input;
        const prisma = ctx.prisma;

        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: {
            capturedInputVisibility: true,
            capturedOutputVisibility: true,
          },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        const teamsWithAccess = await prisma.teamUser.findMany({
          where: {
            userId: ctx.session.user.id,
            team: {
              projects: {
                some: {
                  id: projectId,
                },
              },
            },
          },
          select: {
            role: true,
          },
        });

        const isUserPrivileged = teamsWithAccess.some(
          (teamUser: { role: TeamUserRole }) =>
            teamUser.role === TeamUserRole.ADMIN,
        );

        return {
          isRedacted: {
            input: !canAccessSensitiveData(
              project.capturedInputVisibility,
              isUserPrivileged,
            ),
            output: !canAccessSensitiveData(
              project.capturedOutputVisibility,
              isUserPrivileged,
            ),
          },
        };
      },
    ),
  archiveById: protectedProcedure
    .input(z.object({ projectId: z.string(), projectToArchiveId: z.string() }))
    .use(checkProjectPermission("project:delete"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      if (input.projectToArchiveId === input.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot archive the current project",
        });
      }
      const canDeleteTarget = await hasProjectPermission(
        ctx,
        input.projectToArchiveId,
        "project:delete",
      );
      if (!canDeleteTarget) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const result = await prisma.project.updateMany({
        where: { id: input.projectToArchiveId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return { success: true, alreadyArchived: result.count === 0 };
    }),

  triggerTopicClustering: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      const { projectId } = input;
      const { scheduleTopicClusteringForProject } =
        await import("../../background/queues/topicClusteringQueue");

      try {
        // Add the job directly to the queue for immediate processing
        await scheduleTopicClusteringForProject(projectId, true); // true for manual trigger

        return {
          success: true,
          message: "Topic clustering job queued successfully",
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to trigger topic clustering: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      }
    }),
});

async function checkCapturedDataVisibilityPermission({
  ctx,
  input,
  next,
}: {
  ctx: { prisma: PrismaClient; session: Session; permissionChecked: boolean };
  input: {
    projectId: string;
    capturedInputVisibility?: string;
    capturedOutputVisibility?: string;
    traceSharingEnabled?: boolean;
  };
  next: () => Promise<any>;
}) {
  if (
    (input.capturedInputVisibility !== void 0 ||
      input.capturedOutputVisibility !== void 0 ||
      input.traceSharingEnabled !== void 0) &&
    !(await hasProjectPermission(ctx, input.projectId, "project:manage"))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "You don't have permission to change captured data visibility settings",
    });
  }
  return next();
}

const canAccessSensitiveData = (
  visibility: ProjectSensitiveDataVisibilityLevel,
  userIsPrivileged: boolean,
): boolean => {
  switch (visibility) {
    case ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL:
      return false;
    case ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL:
      return true;
    case ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN:
      return userIsPrivileged;
    default:
      console.error("Unexpected visibility level:", visibility);
      return false; // Default to not showing
  }
};
