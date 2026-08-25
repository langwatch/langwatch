import { auditLog } from "~/runtime/app/features/audit-log";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { provisionLangyVirtualKey } from "~/server/app-layer/langy/langyVirtualKey";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "@langwatch/project-contract";
import type { Session } from "~/server/auth";
import { encrypt } from "~/utils/encryption";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";
import { getUserProtectionsForProject } from "../utils";

/**
 * The owner is ADMIN of their own personal team, so `project:create` passes
 * there. A personal workspace holds only the project provisioned with it.
 */
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
    .use(
      declareAuthzMiddleware(
        {
          kind: "custom",
          reason:
            "creating into an existing team asks that team; creating a team alongside asks the organization",
          permissions: ["project:create", "organization:manage"],
        },
        ({ ctx, input, next }) => {
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
        },
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const prisma = ctx.prisma;
      let project;
      try {
        project = await ctx.app.projects.create({
          organizationId: input.organizationId,
          userId,
          teamId: input.teamId,
          newTeamName: input.newTeamName,
          name: input.name,
          language: input.language,
          framework: input.framework,
        });
      } catch (error) {
        if (error instanceof TeamNotInOrganizationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        if (error instanceof PersonalWorkspaceBoundaryError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof ProjectSlugConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }

      // (The eager per-project Langy service key that used to be minted here is
      // gone — Langy now mints a per-turn, per-user session key scoped to exactly
      // what the caller holds; no long-lived project key is provisioned.)

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
        captureException(toError(error), {
          extra: {
            projectId: project.id,
            context: "provisionLangyVirtualKey:project.create",
          },
        });
      }

      return { success: true, projectSlug: project.slug };
    }),
  /**
   * The base key is a project-level write credential, so reading it is gated
   * with `project:update` to match the access it grants. Rotation stays at
   * `project:manage`.
   */
  getProjectAPIKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:update")
    .query(async ({ input, ctx }) => {
      const project = await ctx.app.projects.tryGetById(input.projectId);

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
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      const project = await ctx.app.projects.tryGetById(input.projectId);

      return { firstMessage: project?.firstMessage ?? false };
    }),
  regenerateApiKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:manage")
    .mutation(async ({ input, ctx }) => {
      try {
        const apiKey = await ctx.app.apiKeys.regenerateLegacyProjectKey({
          projectId: input.projectId,
        });

        // Audit log the security-critical action; non-fatal so an audit
        // failure cannot prevent returning the new key to the user.
        await auditLog({
          action: "project.apiKey.regenerated",
          userId: ctx.session.user.id,
          projectId: input.projectId,
        }).catch(captureException);

        return { apiKey };
      } catch (error) {
        if (
          error instanceof ProjectNotFoundError ||
          error instanceof ApiKeyNotFoundError
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
    .permission("project:update")
    .use(checkCapturedDataVisibilityPermission)
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.app.projects.tryGetWithTeam(input.projectId);

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      let updatedProject;
      try {
        updatedProject = await ctx.app.projects.update({
          id: input.projectId,
          organizationId: project.team.organizationId,
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.language !== undefined && { language: input.language }),
            ...(input.framework !== undefined && { framework: input.framework }),
            ...(input.userLinkTemplate !== undefined && {
              userLinkTemplate: input.userLinkTemplate,
            }),
            ...(input.teamId && { teamId: input.teamId }),
            traceSharingEnabled: input.traceSharingEnabled,
            presenceEnabled: input.presenceEnabled,
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
      } catch (error) {
        if (error instanceof DestinationTeamNotFoundError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        if (error instanceof PersonalWorkspaceBoundaryError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof ProjectNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }

      // If trace sharing was disabled, revoke all existing trace shares
      if (
        input.traceSharingEnabled === false &&
        project.traceSharingEnabled === true
      ) {
        await ctx.app.share.revokeAllTraceShares(input.projectId);
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
    .permission("project:view")
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
    .permission("project:delete")
    .mutation(async ({ input, ctx }) => {
      if (input.projectToArchiveId === input.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot archive the current project",
        });
      }
      const canDeleteTarget = await probeProjectPermission(
        ctx,
        input.projectToArchiveId,
        "project:delete",
      );
      if (!canDeleteTarget) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const target = await ctx.app.projects.tryGetWithTeam(
        input.projectToArchiveId,
      );
      if (!target) return { success: true, alreadyArchived: true };

      try {
        await ctx.app.projects.archive({
          id: input.projectToArchiveId,
          organizationId: target.team.organizationId,
        });
        return { success: true, alreadyArchived: false };
      } catch (error) {
        if (error instanceof PersonalProjectProtectedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof ProjectNotFoundError) {
          return { success: true, alreadyArchived: true };
        }
        throw error;
      }
    }),

  triggerTopicClustering: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:update")
    .mutation(async ({ ctx, input }) => {
      try {
        // A request made while a run is already underway is declined by the
        // scheduler, not queued behind it, so an unconditional success would
        // tell the user a run started when nothing did. The read model is the
        // only place that answer is visible before the scheduler makes it, so
        // ask it first and report which of the two the click actually did.
        // Best effort by nature: the scheduler, not this check, is what keeps
        // two runs off one project.
        if ((await ctx.app.topics.getClusteringStatus(input)).isRunInFlight) {
          return {
            started: false as const,
            reason: "already_running" as const,
          };
        }
        await ctx.app.topicClustering.requestClustering({
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
    !(await probeProjectPermission(ctx, input.projectId, "project:manage"))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to change trace sharing settings",
    });
  }
  return next();
}
