import {
  Prisma,
  type PrismaClient,
  type Project,
  ProjectSensitiveDataVisibilityLevel,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import type { Session } from "~/server/auth";
import { KSUID_RESOURCES } from "~/utils/constants";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { encrypt } from "~/utils/encryption";
import { slugify } from "~/utils/slugify";
import { auditLog } from "../../auditLog";
import {
  createLicenseEnforcementService,
  LimitExceededError,
} from "../../license-enforcement";
import { captureException } from "~/utils/posthogErrorCapture";
import { generateApiKey } from "../../utils/apiKeyGenerator";
import {
  checkOrganizationPermission,
  checkProjectPermission,
  checkTeamPermission,
  hasProjectPermission,
  skipPermissionCheck,
  skipPermissionCheckProjectCreation,
} from "../rbac";
import { getUserProtectionsForProject } from "../utils";
import { provisionLangyApiKey } from "~/server/services/langy/langyApiKey";
import { provisionLangyVirtualKey } from "~/server/services/langy/langyVirtualKey";

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
        return checkTeamPermission("project:create")({
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


      const enforcement = createLicenseEnforcementService(prisma);
      try {
        await enforcement.enforceLimitByOrganization({
          organizationId: input.organizationId,
          limitType: "projects",
          user: ctx.session.user,
        });
      } catch (error) {
        if (error instanceof LimitExceededError) {
          void getApp()
            .usageLimits.notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
            cause: {
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            },
          });
        }
        throw error;
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
        await prisma.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: input.organizationId,
            userId: userId,
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: team.id,
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
        },
      });

      // Best-effort: mint Langy's dedicated, least-privilege service key so the
      // assistant works the moment the project exists. A failure here must never
      // block project creation — the backfill reconciler mints any that slip through.
      try {
        await provisionLangyApiKey({
          prisma,
          projectId: project.id,
          organizationId: input.organizationId,
          createdByUserId: userId,
        });
      } catch (error) {
        captureException(error, {
          extra: {
            projectId: project.id,
            context: "provisionLangyApiKey:project.create",
          },
        });
      }

      // Best-effort: mint Langy's gateway virtual key so it shows up in the
      // user's /virtual-keys list from day 1 (configurable model + fallback
      // chain + spend tracking like any other VK). Same best-effort contract
      // as the API key: failure here doesn't block project creation; the
      // credential service re-attempts on first /chat call.
      try {
        await provisionLangyVirtualKey({
          prisma,
          projectId: project.id,
          organizationId: input.organizationId,
          actorUserId: userId,
        });
      } catch (error) {
        captureException(error, {
          extra: {
            projectId: project.id,
            context: "provisionLangyVirtualKey:project.create",
          },
        });
      }

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
  getHasFirstMessage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      const project = await getApp().projects.getById(input.projectId);

      return { firstMessage: project?.firstMessage ?? false };
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
          name: z.string().optional(),
          language: z.string().optional(),
          framework: z.string().optional(),
          piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]).optional(),
          teamId: z.string().optional(),
          capturedInputVisibility: z
            .enum(["REDACTED_TO_ALL", "VISIBLE_TO_ADMIN", "VISIBLE_TO_ALL"])
            .optional(),
          capturedOutputVisibility: z
            .enum(["REDACTED_TO_ALL", "VISIBLE_TO_ADMIN", "VISIBLE_TO_ALL"])
            .optional(),
          traceSharingEnabled: z.boolean().optional(),
          presenceEnabled: z.boolean().optional(),
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
        input.piiRedactionLevel !== undefined &&
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

      if (input.teamId) {
        const destinationTeam = await prisma.team.findFirst({
          where: {
            id: input.teamId,
            organizationId: project.team.organizationId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!destinationTeam) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Destination team not found, is archived, or belongs to a different organization",
          });
        }
      }

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.language !== undefined && { language: input.language }),
          ...(input.framework !== undefined && { framework: input.framework }),
          ...(input.piiRedactionLevel !== undefined && {
            piiRedactionLevel: input.piiRedactionLevel,
          }),
          ...(input.userLinkTemplate !== undefined && {
            userLinkTemplate: input.userLinkTemplate,
          }),
          ...(input.teamId && { teamId: input.teamId }),
          capturedInputVisibility:
            input.capturedInputVisibility ?? project.capturedInputVisibility,
          capturedOutputVisibility:
            input.capturedOutputVisibility ?? project.capturedOutputVisibility,
          traceSharingEnabled:
            input.traceSharingEnabled ?? project.traceSharingEnabled,
          presenceEnabled:
            input.presenceEnabled ?? project.presenceEnabled,
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
        await getApp().share.revokeAllTraceShares(input.projectId);
      }

      return { success: true, projectSlug: updatedProject.slug };
    }),
  // Legacy default-model mutations have been removed alongside the
  // Organization/Team/Project scalar columns they wrote to. Defaults
  // now live in ModelDefaultConfig; the canonical mutation surface is
  // modelProvider.{createConfig,updateConfig,deleteConfig,setRoleAtScope,setFeatureAtScope}.
  getFieldRedactionStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      return {
        isRedacted: {
          input: !protections.canSeeCapturedInput,
          output: !protections.canSeeCapturedOutput,
        },
      };
    }),
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


