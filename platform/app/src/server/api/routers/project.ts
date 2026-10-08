import { auditLog } from "@ee/audit-log/auditLog";
import { declareAuthzMiddleware } from "@langwatch/authz";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AggregateProjectHasNoCredentialError } from "~/server/api-key/errors";
import { getApp } from "~/server/app-layer/app";
import {
  checkOrganizationPermission,
  checkTeamPermission,
} from "~/server/app-layer/authz/permission-adapters";
import { provisionLangyVirtualKey } from "~/server/app-layer/langy/langyVirtualKey";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { aggregateRuleSchema } from "~/server/app-layer/projects/aggregate-rule";
import { AggregateProjectAdminOnlyError } from "~/server/app-layer/projects/errors";
import {
  governanceProjectRouteViolation,
  ProjectNotFoundError,
  personalWorkspaceArchiveViolation,
  personalWorkspaceCreateViolation,
  personalWorkspaceMoveViolation,
} from "~/server/app-layer/projects/project.service";
import {
  AGGREGATE_PROJECT_KIND,
  APPLICATION_PROJECT_KIND,
  aggregateProjectRouteViolation,
  hasTracesToShow,
  isAggregateProjectKind,
} from "~/server/app-layer/projects/project-kinds";
import { mintProjectSlug } from "~/server/app-layer/projects/projectSlug";
import type { Session } from "~/server/auth";
import { TeamService } from "~/server/teams/team.service";
import { encrypt } from "~/utils/encryption";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { generateApiKey } from "../../utils/apiKeyGenerator";
import { getUserProtectionsForProject } from "../utils";

/**
 * The owner is ADMIN of their own personal team, so `project:create` passes
 * there. A personal workspace holds only the project provisioned with it.
 *
 * A team outside the organisation is refused as not found. The scope lineage
 * guard already refuses a request whose team and organisation disagree before
 * this runs; this keeps the helper from reading "no team" as "not personal"
 * should a caller ever reach it another way.
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
  if (!destinationTeam) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
  }
  const violation = personalWorkspaceCreateViolation(
    destinationTeam.isPersonal,
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
 * Whoever creates an aggregate has to be able to open it. `organization:manage`
 * can come from a custom role, but opening an aggregate is decided on the
 * organisation role alone (ADR-144 decision 5), so creation asks the same
 * question rather than leaving a creator locked out of what they made.
 */
function assertCanOpenAggregates(
  organizationRole: string | null | undefined,
): void {
  const violation = aggregateProjectRouteViolation({
    kind: AGGREGATE_PROJECT_KIND,
    organizationRole,
  });
  if (violation) throw new AggregateProjectAdminOnlyError();
}

/**
 * The hidden governance project is not a workspace, and these mutations write
 * Prisma directly rather than going through `ProjectService`, so they enforce
 * the guard themselves. The rule itself is defined once in the projects app
 * layer; see the helper there for why the id being reachable at all matters.
 */
function assertNotGovernanceProject(kind: string | null | undefined): void {
  const violation = governanceProjectRouteViolation(kind);
  if (violation) {
    throw new TRPCError({ code: "FORBIDDEN", message: violation });
  }
}

/**
 * An aggregate owns no credential (ADR-144 decision 7): its stored base key
 * exists because the column is required, every API-key route refuses it, and
 * it is never shown or re-keyed.
 */
function assertProjectHoldsACredential(kind: string | null | undefined): void {
  if (isAggregateProjectKind(kind)) {
    throw new AggregateProjectHasNoCredentialError();
  }
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
        /** ADR-144: an aggregate reads its members and owns no traces. */
        kind: z
          .enum([APPLICATION_PROJECT_KIND, AGGREGATE_PROJECT_KIND])
          .optional(),
        aggregateRule: aggregateRuleSchema.optional(),
      }),
    )
    .use(
      declareAuthzMiddleware(
        {
          kind: "custom",
          reason:
            "creating into an existing team asks that team; creating a team alongside, or an aggregate project anywhere, asks the organization",
          permissions: ["project:create", "organization:manage"],
        },
        async ({ ctx, input, next }) => {
          // An aggregate reads other people's personal projects, so whichever
          // team it attaches to, only an organisation admin may create one
          // (ADR-144 decision 5), whatever a custom role grants. A member of
          // the organisation who is not an admin is refused as admin only,
          // the same way the rule edit refuses; someone outside it has no
          // role to judge and still gets the shared check.
          if (isAggregateProjectKind(input.kind)) {
            const organizationRole =
              await getApp().organizations.getUserOrgRole({
                userId: ctx.session.user.id,
                organizationId: input.organizationId,
              });
            if (organizationRole) assertCanOpenAggregates(organizationRole);
            return checkOrganizationPermission("organization:manage")({
              ctx,
              input,
              next,
            });
          }
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

      await assertTeamCanHoldANewProject(prisma, {
        teamId: input.teamId,
        organizationId: input.organizationId,
      });

      // The middleware refused anyone who may not open an aggregate.
      const isAggregate = isAggregateProjectKind(input.kind);
      // Validated before the team is created, so a refused rule writes nothing.
      const kindFields = await getApp().projects.createKindFields({
        kind: input.kind,
        aggregateRule: input.aggregateRule,
        organizationId: input.organizationId,
      });

      const projectNanoId = nanoid();
      const projectId = `project_${projectNanoId}`;
      const slug = mintProjectSlug({ name: input.name, projectNanoId });

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
        // The team and the ADMIN binding that comes with it belong to the team
        // service: the binding is a grants-ledger fact, and a route is not
        // where the ledger is driven from.
        const team = await new TeamService({ prisma }).createWithFoundingAdmin({
          organizationId: input.organizationId,
          name: input.newTeamName ?? input.name,
          adminUserId: userId,
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
          ...kindFields,
        },
      });

      // Best-effort and never throws: without its key-map row the project
      // reads zero rows from LangWatchQL until the next deploy's backfill.
      await getApp().projects.syncLwqlKeyMapRow(project);

      // (The eager per-project Langy service key that used to be minted here is
      // gone — Langy now mints a per-turn, per-user session key scoped to exactly
      // what the caller holds; no long-lived project key is provisioned.)

      // An aggregate owns no traces, so it gets no gateway key whose traces
      // would land on it (ADR-144 decision 7). It does get its members, before
      // the creator lands on it, and never at the cost of the create.
      if (isAggregate) {
        await getApp().projects.startAggregate({
          aggregateProjectId: project.id,
        });
        return { success: true, projectSlug: project.slug };
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
   * ADR-144 block E: an organisation admin edits which projects an aggregate
   * reads. The new rule is validated, written and reconciled before this
   * answers, so a dropped project's read is revoked by the time the admin
   * sees the result. Its own mutation rather than a field on `update`, which
   * any project editor may call.
   */
  updateAggregateRule: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        aggregateRule: aggregateRuleSchema,
      }),
    )
    .permission("organization:manage", { via: "projectId" })
    .mutation(async ({ input, ctx }) => {
      const current = await getApp().projects.getWithTeam(input.projectId);
      if (!current || !isAggregateProjectKind(current.kind)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }
      const organizationId = current.team.organizationId;
      assertCanOpenAggregates(
        await getApp().organizations.getUserOrgRole({
          userId: ctx.session.user.id,
          organizationId,
        }),
      );
      try {
        const { members } = await getApp().projects.updateAggregateRule({
          projectId: input.projectId,
          organizationId,
          aggregateRule: input.aggregateRule,
        });
        return { success: true, members };
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),
  /**
   * ADR-144: the projects an organisation admin may pick for a new
   * aggregate's explicit rule. Unlike `organization.getAll`, which carries the
   * teams the caller can see, this lists every member's personal workspace
   * and names its owner, so it is gated the same way creating the aggregate
   * is: organisation admins only.
   */
  aggregateMemberCandidates: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      assertCanOpenAggregates(
        await getApp().organizations.getUserOrgRole({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        }),
      );
      return getApp().projects.aggregateMemberCandidates({
        organizationId: input.organizationId,
      });
    }),
  /**
   * The base key grants full access to one project. Revealing it is therefore
   * an administrator action, just like rotating it.
   */
  getProjectAPIKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:manage", {
      nondisclosure: "not-found-outside-organization",
    })
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { apiKey: true, kind: true },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }
      assertProjectHoldsACredential(project.kind);

      return { apiKey: project.apiKey };
    }),
  getHasFirstMessage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input }) => {
      const project = await getApp().projects.getById(input.projectId);

      return { firstMessage: project ? hasTracesToShow(project) : false };
    }),
  regenerateApiKey: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:manage")
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const target = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { kind: true },
      });
      assertNotGovernanceProject(target?.kind);
      assertProjectHoldsACredential(target?.kind);

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
    .permission("project:update")
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

      assertNotGovernanceProject(project.kind);

      if (input.teamId) {
        const destinationTeam = await prisma.team.findFirst({
          where: {
            id: input.teamId,
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
          isMovingTeams: input.teamId !== project.teamId,
          isProjectPersonal: project.isPersonal,
          isDestinationTeamPersonal: destinationTeam.isPersonal,
        });
      }

      const updatedProject = await prisma.project.update({
        where: { id: input.projectId },
        data: {
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
      const prisma = ctx.prisma;
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

      const target = await prisma.project.findUnique({
        where: { id: input.projectToArchiveId },
        select: {
          isPersonal: true,
          kind: true,
          team: { select: { organizationId: true } },
        },
      });
      assertNotGovernanceProject(target?.kind);
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
      if (result.count > 0 && target) {
        await getApp().projects.afterArchive({
          project: { id: input.projectToArchiveId, kind: target.kind },
          organizationId: target.team.organizationId,
        });
      }
      return { success: true, alreadyArchived: result.count === 0 };
    }),

  triggerTopicClustering: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:update")
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
    !(await probeProjectPermission(ctx, input.projectId, "project:manage"))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to change trace sharing settings",
    });
  }
  return next();
}
