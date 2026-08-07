import { auditLog } from "@ee/audit-log/auditLog";
import { generate } from "@langwatch/ksuid";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { provisionLangyVirtualKey } from "~/server/app-layer/langy/langyVirtualKey";
import {
  personalWorkspaceArchiveViolation,
  personalWorkspaceCreateViolation,
  personalWorkspaceMoveViolation,
} from "~/server/app-layer/projects/project.service";
import type { Session } from "~/server/auth";
import { KSUID_RESOURCES } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import { generateApiKey } from "../../utils/apiKeyGenerator";
import {
  checkOrganizationPermission,
  checkProjectPermission,
  checkTeamPermission,
  hasProjectPermission,
  skipPermissionCheckProjectCreation,
} from "../rbac";
import { getUserProtectionsForProject } from "../utils";

/**
 * The owner is ADMIN of their own personal team, so `project:create` passes
 * there. A personal workspace holds only the project provisioned with it.
 */
async function assertTeamCanHoldANewProject(
  prisma: PrismaClient,
  { teamId, organizationId }: { teamId?: string; organizationId: string },
): Promise<void> {
  if (!teamId) return;

  const destinationTeam = await prisma.team.findFirst({
    where: { id: teamId, organizationId },
    select: { isPersonal: true },
  });
  const violation = personalWorkspaceCreateViolation(
    destinationTeam?.isPersonal ?? false,
  );
  if (violation) {
    throw new TRPCError({ code: "FORBIDDEN", message: violation });
  }
}

/**
 * The boundary itself is defined once in the projects app layer, which this
 * router does not go through. See the helper there for why it holds.
 */
function assertMoveStaysOutOfPersonalWorkspaces({
  isMovingTeams,
  isProjectPersonal,
  isDestinationTeamPersonal,
}: {
  isMovingTeams: boolean;
  isProjectPersonal: boolean;
  isDestinationTeamPersonal: boolean;
}): void {
  if (!isMovingTeams) return;

  const violation = personalWorkspaceMoveViolation({
    isProjectPersonal,
    isDestinationTeamPersonal,
  });
  if (violation) {
    throw new TRPCError({ code: "FORBIDDEN", message: violation });
  }
}

/**
 * Creates a new team to hold the project when the caller didn't pick an
 * existing one — named from `newTeamName` or falling back to the project's
 * own name — and makes the creating user its ADMIN via a role binding.
 */
async function ensureTeamForNewProject({
  prisma,
  organizationId,
  userId,
  newTeamName,
  projectName,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  newTeamName: string | undefined;
  projectName: string;
}): Promise<string> {
  const teamName = newTeamName ?? projectName;
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
      organizationId,
    },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: team.id,
    },
  });
  return team.id;
}

/**
 * Best-effort: mint Langy's gateway virtual key so it shows up in the
 * user's /virtual-keys list from day 1 (configurable model + fallback
 * chain + spend tracking like any other VK). Same best-effort contract as
 * the API key: failure here doesn't block project creation; the credential
 * service re-attempts on first /chat call.
 */
async function provisionLangyVirtualKeyBestEffort({
  prisma,
  projectId,
  organizationId,
  actorUserId,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
  actorUserId: string;
}): Promise<void> {
  try {
    await provisionLangyVirtualKey({
      prisma,
      projectId,
      organizationId,
      actorUserId,
    });
  } catch (error) {
    captureException(toError(error), {
      extra: {
        projectId,
        context: "provisionLangyVirtualKey:project.create",
      },
    });
  }
}

/**
 * When a project move is requested, validates the destination team exists,
 * is active, and belongs to the same org, then enforces the
 * personal-workspace boundary on the move itself.
 */
async function assertValidTeamMove({
  prisma,
  teamId,
  project,
}: {
  prisma: PrismaClient;
  teamId: string | undefined;
  project: {
    teamId: string;
    isPersonal: boolean;
    team: { organizationId: string };
  };
}): Promise<void> {
  if (!teamId) return;

  const destinationTeam = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId: project.team.organizationId,
      archivedAt: null,
    },
    select: { id: true, isPersonal: true },
  });
  if (!destinationTeam) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Destination team not found, is archived, or belongs to a different organization",
    });
  }

  assertMoveStaysOutOfPersonalWorkspaces({
    isMovingTeams: teamId !== project.teamId,
    isProjectPersonal: project.isPersonal,
    isDestinationTeamPersonal: destinationTeam.isPersonal,
  });
}

/** Builds the `project.update` patch from the mutation input, defaulting the two toggles from the current row. */
function buildProjectUpdateData({
  input,
  project,
}: {
  input: {
    name?: string;
    language?: string;
    framework?: string;
    teamId?: string;
    traceSharingEnabled?: boolean;
    presenceEnabled?: boolean;
    userLinkTemplate?: string;
    s3Endpoint?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    s3Bucket?: string;
  };
  project: { traceSharingEnabled: boolean; presenceEnabled: boolean };
}): Prisma.ProjectUpdateInput {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.language !== undefined && { language: input.language }),
    ...(input.framework !== undefined && { framework: input.framework }),
    ...(input.userLinkTemplate !== undefined && {
      userLinkTemplate: input.userLinkTemplate,
    }),
    ...(input.teamId && { teamId: input.teamId }),
    traceSharingEnabled:
      input.traceSharingEnabled ?? project.traceSharingEnabled,
    presenceEnabled: input.presenceEnabled ?? project.presenceEnabled,
    s3Endpoint: input.s3Endpoint ? encrypt(input.s3Endpoint) : null,
    s3AccessKeyId: input.s3AccessKeyId ? encrypt(input.s3AccessKeyId) : null,
    s3SecretAccessKey: input.s3SecretAccessKey
      ? encrypt(input.s3SecretAccessKey)
      : null,
    s3Bucket: input.s3Bucket,
  };
}

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

      await assertTeamCanHoldANewProject(prisma, {
        teamId: input.teamId,
        organizationId: input.organizationId,
      });

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

      const teamId =
        input.teamId ??
        (await ensureTeamForNewProject({
          prisma,
          organizationId: input.organizationId,
          userId,
          newTeamName: input.newTeamName,
          projectName: input.name,
        }));

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

      // (The eager per-project Langy service key that used to be minted here is
      // gone — Langy now mints a per-turn, per-user session key scoped to exactly
      // what the caller holds; no long-lived project key is provisioned.)

      await provisionLangyVirtualKeyBestEffort({
        prisma,
        projectId: project.id,
        organizationId: input.organizationId,
        actorUserId: userId,
      });

      return { success: true, projectSlug: project.slug };
    }),
  /**
   * The base key is a project-level write credential, so reading it is gated
   * with `project:update` to match the access it grants. Rotation stays at
   * `project:manage`.
   */
  getProjectAPIKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
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

        // Audit log the security-critical action; non-fatal so an audit
        // failure cannot prevent returning the new key to the user.
        await auditLog({
          action: "project.apiKey.regenerated",
          userId: ctx.session.user.id,
          projectId: input.projectId,
        }).catch(captureException);

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
          teamId: z.string().optional(),
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

      await assertValidTeamMove({ prisma, teamId: input.teamId, project });

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: buildProjectUpdateData({ input, project }),
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
        // Human label of who CAN see a restricted field (e.g. "Admins, Security"
        // or "no one"), so the redaction placeholder can explain why content is
        // hidden and who to ask. Null when the field is visible.
        visibleTo: {
          input: protections.capturedInputVisibleTo ?? null,
          output: protections.capturedOutputVisibleTo ?? null,
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

      const target = await prisma.project.findUnique({
        where: { id: input.projectToArchiveId },
        select: { isPersonal: true },
      });
      const archiveViolation = personalWorkspaceArchiveViolation(
        target?.isPersonal ?? false,
      );
      if (archiveViolation) {
        throw new TRPCError({ code: "FORBIDDEN", message: archiveViolation });
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
    .mutation(async ({ ctx, input }) => {
      try {
        const app = getApp();
        // A request made while a run is already underway is declined by the
        // scheduler, not queued behind it, so an unconditional success would
        // tell the user a run started when nothing did. The read model is the
        // only place that answer is visible before the scheduler makes it, so
        // ask it first and report which of the two the click actually did.
        // Best effort by nature: the scheduler, not this check, is what keeps
        // two runs off one project.
        if (await app.topicClustering.status.isRunInFlight(input)) {
          return {
            started: false as const,
            reason: "already_running" as const,
          };
        }
        await app.topicClustering.requestClustering({
          tenantId: input.projectId,
          occurredAt: Date.now(),
          trigger: "manual",
          requestedByUserId: ctx.session.user.id,
        });
        return { started: true as const };
      } catch (error) {
        captureException(toError(error), {
          extra: { projectId: input.projectId },
        });
        // The UI toasts this message verbatim, and the failures behind it are
        // event-store/projection internals (Prisma detail, hostnames) — the
        // same class of text the status read deliberately never exposes.
        // Detail goes to the log above; the customer gets a fixed sentence.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to trigger topic clustering",
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
    traceSharingEnabled?: boolean;
  };
  next: () => Promise<any>;
}) {
  if (
    input.traceSharingEnabled !== void 0 &&
    !(await hasProjectPermission(ctx, input.projectId, "project:manage"))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to change trace sharing settings",
    });
  }
  return next();
}
