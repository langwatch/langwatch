import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/server/app-layer/billing/nurturing/inviteAcceptance";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { identityEmail, joinRequestsService } from "~/server/app-layer/identity/runtime";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import { enrichTeamWithRoleBindings } from "~/server/app-layer/organizations/organization.service";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import { trackServerEvent } from "~/server/posthog";
import { assertNoPersonalTeamScope } from "~/server/role-bindings/personal-team-scope";
import { signUpDataSchema } from "~/server/schemas/sign-up-data.schema";
import { decrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import {
  InviteService,
  maskInvitedAddress,
  matchInviteToAcceptor,
  resolveInviteDisplayStatus,
} from "../../invites/invite.service";
import { buildInviteAcceptUrl } from "../../invites/invite-link";
import { assertInviteSendAllowed } from "../../invites/invite-send-throttle";
import { LimitExceededError } from "../../license-enforcement/errors";
import { LicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";
import {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "../../license-enforcement/license-limit-guard";
import { getRoleChangeType } from "../../license-enforcement/member-classification";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS, isCustomRole } from "../enterprise";
import {
  batchScopePermissions,
  checkOrganizationPermission,
  checkProjectPermission,
  type PermissionMiddlewareParams,
} from "../rbac";

const customTeamRoleInputSchema = z
  .string()
  .regex(/^custom:[a-zA-Z0-9_-]+$/, "Custom role must be in format 'custom:{roleId}'");
const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);
const teamRoleInputSchema = z.union([builtInTeamRoleInputSchema, customTeamRoleInputSchema]);

/**
 * The audit-log read authorizes at the ORGANIZATION tier, always.
 *
 * A bare `.permission("auditLog:view")` cannot express this: `auditLog` is
 * grantable at project/team/organization, and the declared check resolves to
 * the narrowest tier whose id the input carries. Because `projectId` is an
 * optional filter here, supplying it would move the whole check to the
 * project tier and leave `input.organizationId` — the id the query is
 * anchored on — unauthorized. A caller holding `auditLog:view` on any one
 * project could then read a different organization's org-scoped audit trail.
 *
 * So the org id is checked unconditionally, and when a project filter is
 * present it is additionally checked at the project tier, so a project-scoped
 * grant cannot widen a read to rows outside that project either.
 */
function checkAuditLogPermission() {
  const organizationCheck = checkOrganizationPermission("auditLog:view");
  const projectCheck = checkProjectPermission("auditLog:view");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the audit-log read is authorized at the organization tier the query is anchored on, never the optional project filter",
      permissions: ["auditLog:view"],
    },
    async (
      params: PermissionMiddlewareParams<{
        organizationId: string;
        projectId?: string;
      }>,
    ) => {
      const { projectId } = params.input;
      if (!projectId) return organizationCheck(params);
      return organizationCheck({
        ...params,
        next: () => projectCheck({ ...params, input: { projectId } }),
      });
    },
  );
}

export const organizationRouter = createTRPCRouter({
  createAndAssign: protectedProcedure
    .input(
      z.object({
        orgName: z.string().optional(),
        phoneNumber: z.string().optional(),
        signUpData: signUpDataSchema.optional(),
        primaryIntent: z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]).optional(),
      }),
    )
    .noPermission({
      reason:
        "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
    })
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.organizations.createAndAssign({
        userId: ctx.session.user.id,
        orgName: input.orgName,
        phoneNumber: input.phoneNumber,
        signUpData: input.signUpData,
        primaryIntent: input.primaryIntent,
        userDisplayName: ctx.session.user.name,
      });

      return {
        success: true,
        organization: result.organization,
        team: result.team,
      };
    }),

  deleteMember: protectedProcedure
    .input(z.object({ userId: z.string(), organizationId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      // The self-removal guard lives in the service now; it refuses with
      // `cannot_remove_self`, which the handled-error middleware puts on the
      // wire for the client's code-keyed copy.
      await ctx.app.organizations.deleteMember({
        organizationId: input.organizationId,
        userId: input.userId,
        actingUserId: ctx.session.user.id,
      });

      return { success: true };
    }),

  /**
   * Disables or re-enables a membership so an organization can reconcile down
   * to the seats its license covers. See seat-reconciliation.feature.
   */
  setMemberDisabled: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        organizationId: z.string(),
        disabled: z.boolean(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.app.organizations.setMemberDisabled({
          organizationId: input.organizationId,
          userId: input.userId,
          disabled: input.disabled,
          actingUser: ctx.session.user,
        });
      } catch (error) {
        if (error instanceof MemberSeatLimitReachedError) {
          // The same shape every other member-limit refusal throws, so the
          // client's global handler opens the limit modal with the real
          // numbers and its "Upgrade license" link, rather than this route
          // inventing copy of its own.
          throw new TRPCError({
            code: "FORBIDDEN",
            message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
            cause: {
              limitType: error.meta.limitType,
              current: error.meta.current,
              max: error.meta.max,
            },
          });
        }
        throw error;
      }

      return { success: true };
    }),

  getAll: protectedProcedure
    .input(
      z.object({
        isDemo: z.boolean().optional(),
      }),
    )
    .noPermission({
      reason:
        "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
    })
    .query(async ({ ctx, input }) => {
      const isDemo = input?.isDemo ?? false;
      const userId = ctx.session.user.id;
      const demoProjectUserId = isDemo ? env.DEMO_PROJECT_USER_ID : "";
      const demoProjectId = isDemo ? env.DEMO_PROJECT_ID : "";

      const organizations = (await ctx.app.organizations.getAllForUser({
        userId,
        isDemo,
        demoProjectUserId,
        demoProjectId,
      })) as FullyLoadedOrganization[];

      // Fetch all team- and org-scoped RoleBindings for the user (direct or via group)
      // so we can synthesize team membership for users who have access only through groups.
      const orgIds = organizations.map((o) => o.id);
      const userRoleBindings =
        orgIds.length > 0
          ? await ctx.app.permissions.listBindingsForSynthesis({
              orgIds,
              userId,
            })
          : [];

      // The plaintext S3 secret access key is only needed by the org/project
      // settings forms, which are organization:manage surfaces that round-trip
      // the stored value on save. Everyone else gets it redacted — the API
      // must not hand the decrypted secret to lite/viewer members just
      // because the UI happens not to render it.
      const manageableOrgIds = new Set<string>();
      // Decides the base-key redaction below. One batched resolution per org,
      // not one check per project — a scoped check is ~4 queries, so a
      // per-project fan-out would scale with the org's project count.
      const updatableProjectsByOrg = new Map<string, Map<string, boolean>>();
      for (const organization of organizations) {
        const canManage = await probeOrganizationPermission(
          ctx,
          organization.id,
          "organization:manage",
        );
        if (canManage) manageableOrgIds.add(organization.id);

        const projectTeamId: Record<string, string> = {};
        for (const team of organization.teams) {
          for (const project of team.projects) {
            projectTeamId[project.id] = team.id;
          }
        }
        const projectIds = Object.keys(projectTeamId);
        if (projectIds.length === 0) continue;

        const { projects: updatableProjects } = await batchScopePermissions(ctx, {
          organizationId: organization.id,
          teamIds: [],
          projectIds,
          projectTeamId,
          permission: "project:update",
        });
        updatableProjectsByOrg.set(organization.id, updatableProjects);
      }

      for (const organization of organizations) {
        const canManage = manageableOrgIds.has(organization.id);
        for (const project of organization.teams.flatMap((team) => team.projects)) {
          if (project.s3AccessKeyId) {
            project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
          }
          project.s3SecretAccessKey =
            canManage && project.s3SecretAccessKey ? decrypt(project.s3SecretAccessKey) : null;
          if (project.s3Endpoint) {
            project.s3Endpoint = decrypt(project.s3Endpoint);
          }
          // The base key is a project-level write credential. Same rule as the
          // S3 secret above: send it only to those who can change the project,
          // rather than relying on the UI not to render it. Demo projects
          // expose it to no one.
          const canUpdateProject =
            updatableProjectsByOrg.get(organization.id)?.get(project.id) ?? false;
          if (isDemo || !canUpdateProject) {
            project.apiKey = "";
          }
          // The LangWatchQL key is a control-plane secret: no client surface
          // reads it, so unlike the base key it is sent to no one at all.
          project.lwqlKey = "";
        }
      }
      for (const organization of organizations) {
        const isDemoOrg =
          isDemo &&
          organization.teams.some((team) =>
            team.projects.some((project) => project.id === demoProjectId),
          );

        organization.members = organization.members.filter(
          (member) => member.userId === userId || member.userId === demoProjectUserId,
        );
        if (organization.s3AccessKeyId) {
          organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
        }
        organization.s3SecretAccessKey =
          manageableOrgIds.has(organization.id) && organization.s3SecretAccessKey
            ? decrypt(organization.s3SecretAccessKey)
            : null;
        if (organization.s3Endpoint) {
          organization.s3Endpoint = decrypt(organization.s3Endpoint);
        }

        // The Organization row still carries the dead Elasticsearch columns
        // (kept for deploy safety until a follow-up migration drops them).
        // Never ship the stored ciphertext / flag to clients.
        organization.elasticsearchNodeUrl = null;
        organization.elasticsearchApiKey = null;
        organization.useCustomElasticsearch = false;

        // A user can be an org admin via either the legacy OrganizationUser row
        // OR via an ORGANIZATION-scoped ADMIN RoleBinding (direct or via group).
        // Without this, users onboarded through the RoleBinding flow with no
        // OrganizationUser row are treated as external and lose access to every
        // team that lacks an explicit team/project binding.
        const isOrgAdminViaBinding = userRoleBindings.some(
          (b) =>
            b.organizationId === organization.id &&
            b.scopeType === RoleBindingScopeType.ORGANIZATION &&
            b.role === TeamUserRole.ADMIN,
        );
        // RoleBinding(scope=ORGANIZATION, role=ADMIN) is authoritative when present:
        // promote the user's exposed role so the frontend hook
        // `useOrganizationTeamProject().organizationRole` and downstream guards
        // (`withPermissionGuard("organization:manage")`) honor it. Without this,
        // a stale `OrganizationUser.role=MEMBER` row shadows a fresh ADMIN
        // RoleBinding, gating the admin out of /governance + /governance/*.
        // Backend RBAC paths already honor RoleBindings (`resolveOrganizationPermission`,
        // `requireApiKeyPermission`); this closes the page-guard / SSR-only drift.
        if (isOrgAdminViaBinding) {
          if (organization.members[0]) {
            organization.members[0].role = OrganizationUserRole.ADMIN;
          } else {
            organization.members = [
              {
                userId,
                organizationId: organization.id,
                role: OrganizationUserRole.ADMIN,
              } as (typeof organization.members)[number],
            ];
          }
        }
        const isExternal =
          !isOrgAdminViaBinding &&
          organization.members[0]?.role !== "ADMIN" &&
          organization.members[0]?.role !== "MEMBER";

        organization.teams = organization.teams.filter((team) => {
          team.members = team.members.filter(
            (member) => member.userId === userId || member.userId === demoProjectUserId,
          );

          // RoleBinding is authoritative for team membership and role.
          // Always prefer a team-scoped RoleBinding over any stale TeamUser row,
          // since dual-writes to TeamUser have been removed.
          // Org-scoped bindings are intentionally excluded: org MEMBER/VIEWER bindings
          // only grant organization:view — they don't give team-level access.
          // Org admins are handled by the organizationRole === ADMIN shortcut in
          // the frontend hasPermission and backend resolveTeamPermission.
          //
          // NOTE: imported as a standalone function (not a service method) because
          // The App's organization service is wrapped by traced(), which would turn this
          // sync call into a Promise and silently drop team.members.
          const enriched = enrichTeamWithRoleBindings(
            team,
            userId,
            userRoleBindings,
            organization.id,
          );
          team.members = enriched.members;

          if (isDemoOrg) return true;
          return isExternal ? team.members.some((member) => member.userId === userId) : true;
        });

        if (isDemoOrg) {
          organization.teams = organization.teams.flatMap((team) => {
            if (team.projects.some((project) => project.id === demoProjectId)) {
              team.projects = team.projects.filter((project) => project.id === demoProjectId);

              team.members = team.members.filter(
                (member) => member.userId === demoProjectUserId || member.userId === userId,
              );
              return [team];
            } else {
              return [];
            }
          });
        }
      }

      return organizations;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          name: z.string(),
          s3Endpoint: z.string().optional(),
          s3AccessKeyId: z.string().optional(),
          s3SecretAccessKey: z.string().optional(),
          s3Bucket: z.string().optional(),
          presenceEnabled: z.boolean().optional(),
          traceSharingEnabled: z.boolean().optional(),
          supportContact: z.string().max(500).nullable().optional(),
          primaryIntent: z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]).nullable().optional(),
        })
        .refine(
          (data) => {
            const hasEndpoint = !!data.s3Endpoint?.trim();
            const hasAccessKey = !!data.s3AccessKeyId?.trim();
            const hasSecretKey = !!data.s3SecretAccessKey?.trim();

            return (
              (hasEndpoint && hasAccessKey && hasSecretKey) ||
              (!hasEndpoint && !hasAccessKey && !hasSecretKey)
            );
          },
          {
            message:
              "S3 Endpoint, Access Key ID, and Secret Access Key must all be provided together",
          },
        ),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      // The settings form round-trips every S3 field on save, so an absent
      // credential means "clear it". `updateSettings` is a partial update
      // where absent means "leave it alone", so the clearing is made
      // explicit here. `s3Bucket` keeps its historical leave-alone-if-absent
      // behavior. The ADR-057 trace-sharing disable cascade (revoke every
      // existing trace link across the org) lives in the service.
      await ctx.app.organizations.updateSettings({
        organizationId: input.organizationId,
        name: input.name,
        s3Endpoint: input.s3Endpoint ?? null,
        s3AccessKeyId: input.s3AccessKeyId ?? null,
        s3SecretAccessKey: input.s3SecretAccessKey ?? null,
        s3Bucket: input.s3Bucket,
        presenceEnabled: input.presenceEnabled,
        traceSharingEnabled: input.traceSharingEnabled,
        supportContact: input.supportContact,
        primaryIntent: input.primaryIntent,
      });

      return { success: true };
    }),

  getOrganizationWithMembersAndTheirTeams: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        includeDeactivated: z.boolean().optional(),
      }),
    )
    // Stays at organization:view because non-admin pickers (annotation
    // queue assignment, trace participants, group dialogs) legitimately
    // need to enumerate org members by name. The full record contains
    // member emails, which are admin-surface PII — we redact them on
    // the way out for non-admin callers below.
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      const organization = await ctx.app.organizations.getOrganizationWithMembers({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        includeDeactivated: input.includeDeactivated ?? false,
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // PII guard for picker callers: when the caller doesn't have
      // organization:manage, null out other members' emails AND
      // strip their personal-workspace teamMemberships (existence of
      // someone else's personal workspace is itself private). The
      // caller's own email + own personal workspace stay visible.
      const callerHasManage = await probeOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );
      if (!callerHasManage) {
        const callerId = ctx.session.user.id;
        for (const m of organization.members ?? []) {
          if (m.user.id !== callerId) {
            m.user.email = null;
          }
          // Drop teamMembership rows that point at someone else's
          // personal workspace. The caller's own personal workspace
          // stays even when iterating someone else's memberships
          // (it's their team too — they belong to it).
          if (m.user.teamMemberships) {
            m.user.teamMemberships = m.user.teamMemberships.filter((tm) => {
              if (!tm.team.isPersonal) return true;
              return tm.team.ownerUserId === callerId;
            });
          }
        }
      }

      return organization;
    }),

  getMemberById: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
      }),
    )
    // Tightened from organization:view to manage — exposing one
    // member's full record (role assignments, team memberships) is an
    // admin-surface read, not a peer-context read. No TS callers
    // currently depend on member-role access to this procedure.
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      const member = await ctx.app.organizations.getMemberById({
        organizationId: input.organizationId,
        userId: input.userId,
        currentUserId: ctx.session.user.id,
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      return member;
    }),

  createInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            teamIds: z.string().optional(), // Keep for backward compatibility
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: teamRoleInputSchema,
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
            role: z.nativeEnum(OrganizationUserRole),
          }),
        ),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleInvite = input.invites.some((invite) =>
        (invite.teams ?? []).some((t) => typeof t.role === "string" && isCustomRole(t.role)),
      );
      if (hasCustomRoleInvite) {
        await assertEnterprisePlan({
          planProvider: ctx.app.planProvider,
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const inviteService = InviteService.create(ctx.prisma, { mailer: ctx.app.mailer });

      let created: Awaited<ReturnType<typeof inviteService.createInvites>>;
      try {
        // Lenient validation keeps this procedure's historical form
        // behavior: invalid teams and custom roles drop the assignment or
        // the invite quietly instead of refusing the batch.
        created = await inviteService.createInvites({
          organizationId: input.organizationId,
          invites: input.invites,
          user: ctx.session.user,
          validation: "lenient",
        });
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }
        if (error instanceof LimitExceededError) {
          void ctx.app.usageLimits
            .notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }

      if (created.invites.length > 0) {
        // D11 x D12, invitation -> request: a formal invitation sent to
        // somebody with an open request ANSWERS it. The invitation carries
        // the role and the teams, which is the flow that owns them, so the
        // request resolves as approved-by-invitation rather than staying
        // open beside it. Silent when nothing is open, and never fatal — the
        // invitation is the durable outcome here.
        await Promise.all(
          created.invites.map(async (record) => {
            const invited = await ctx.prisma.user.findFirst({
              where: { email: record.invite.email },
              select: { id: true },
            });
            if (!invited) return;
            try {
              await joinRequestsService({
                authzGrants: ctx.app.authzGrants,
                featureFlags: ctx.app.featureFlags,
                mailer: ctx.app.mailer,
              }).resolveByInvitation({
                userId: invited.id,
                organizationId: record.invite.organizationId,
                inviteId: record.invite.id,
              });
            } catch (error) {
              captureException(toError(error), {
                tags: { organizationId: record.invite.organizationId },
              });
            }
          }),
        );

        trackServerEvent({
          userId: ctx.session.user.id,
          event: "team_member_invited",
          properties: { inviteCount: created.invites.length },
        });

        const memberCount = created.organization.members.length + created.invites.length;
        for (const record of created.invites) {
          fireTeamMemberInvitedNurturing({
            userId: ctx.session.user.id,
            teamMemberCount: memberCount,
            role: record.invite.role,
          });
        }
      }

      return created.invites;
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      const inviteService = InviteService.create(ctx.prisma, { mailer: ctx.app.mailer });
      await inviteService.revokeInvite({
        organizationId: input.organizationId,
        inviteId: input.inviteId,
      });
    }),
  resendInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      // Throttled per INVITATION, because the thing being protected is the
      // recipient's inbox rather than this server: an admin with three
      // invitations out may resend all three, and none of the three gets
      // mailed repeatedly. Checked before the resend so a refused attempt
      // leaves the live code alone — rotation is the old link's revocation,
      // and a throttled click must not quietly break the link already sent.
      await assertInviteSendAllowed({ inviteId: input.inviteId });

      const inviteService = InviteService.create(ctx.prisma, { mailer: ctx.app.mailer });
      const { invite, emailNotSent } = await inviteService.resendInvite({
        organizationId: input.organizationId,
        inviteId: input.inviteId,
      });
      return {
        invite,
        emailNotSent,
        inviteUrl: buildInviteAcceptUrl(invite.inviteCode),
      };
    }),
  getOrganizationPendingInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    // Tightened from organization:view to manage — pending invites
    // expose admin intent (who's being added, with what role / to
    // which teams). MEMBER reading this is a leak. Both TS callers
    // (settings/members, SubscriptionPage) are admin-only surfaces.
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      const inviteService = InviteService.create(ctx.prisma, { mailer: ctx.app.mailer });
      return inviteService.listInvites({
        organizationId: input.organizationId,
      });
    }),
  acceptInvite: protectedProcedure
    .input(
      z.object({
        inviteCode: z.string(),
      }),
    )
    .noPermission({
      reason:
        "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
    })
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const session = ctx.session;
      const invite = await prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        include: { organization: true },
      });

      // A revoked invitation reads exactly like a missing one on purpose:
      // the journey ends quietly, revealing nothing about the organization
      // or the inviter. Expired is different — it is recoverable (the
      // inviter resends in one click), so it gets its own named refusal.
      if (!invite || invite.status === "REVOKED") {
        throw new InviteNotFoundError("Invitation not found");
      }

      if (!session?.user?.email) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be signed in to accept the invite",
        });
      }

      if (invite.status === "ACCEPTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_ALREADY_ACCEPTED_MESSAGE,
        });
      }

      if (resolveInviteDisplayStatus(invite) === "EXPIRED") {
        throw new InviteExpiredError();
      }

      if (invite.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_NOT_READY_MESSAGE,
        });
      }

      // Identifier-aware acceptance (D11): an invitation targets an address,
      // and ANY of the signed-in user's VERIFIED identifiers holding that
      // address vouches for them — password, Google, or the org's SSO. The
      // person invited by email who signed in with their Google account is
      // no longer a support ticket. A user not yet on identifiers answers
      // `null` and keeps the legacy session-email comparison byte-for-byte.
      const { matches: inviteEmailMatches, viaIdentifierId } = matchInviteToAcceptor({
        inviteEmail: invite.email,
        sessionEmail: session.user.email,
        matchable: await identityEmail().verifiedEmailsOf({
          userId: session.user.id,
        }),
      });
      // Signed in as somebody else is a wrong turn, not a refusal: the screen
      // names which account is wanted and offers the way back. The hint is
      // masked because an invite code is a bearer token — the landing already
      // declines to name the invited address, and a mismatch is not a hole to
      // read it through.
      if (!inviteEmailMatches) {
        throw new InviteWrongAccountError(maskInvitedAddress(invite.email));
      }

      // No transaction: the invite's grants are ledger commands, so the
      // membership row has to be committed before they are emitted, and the
      // invite is only marked ACCEPTED once everything before it has landed
      // (a still-PENDING invite is one still to apply).
      await InviteService.create(prisma, { mailer: ctx.app.mailer }).applyInvite({
        userId: session.user.id,
        invite,
        viaIdentifierId,
      });

      // D11 x D12, acceptance -> request: accepting an invitation withdraws
      // the same person's open request for this organization, so the
      // membership lands exactly once and the admins' panel empties itself.
      // Never fatal — the membership is the durable outcome, and a request
      // left open is answered by the next approval or by the expiry.
      try {
        await joinRequestsService({
          authzGrants: ctx.app.authzGrants,
          featureFlags: ctx.app.featureFlags,
          mailer: ctx.app.mailer,
        }).withdrawOnInvitationAccepted({
          userId: session.user.id,
          organizationId: invite.organizationId,
        });
      } catch (error) {
        captureException(toError(error), {
          tags: { organizationId: invite.organizationId },
        });
      }

      // Provision the user's Personal Workspace (Team.isPersonal +
      // Project.isPersonal) for this org. Idempotent — safe if a prior
      // invite already triggered it. Runs outside the invite tx so an
      // unexpected failure here doesn't roll the membership back; the
      // next login will retry via the lazy backfill in
      // `user.personalContext`.
      try {
        await ctx.app.organizations.ensurePersonalWorkspace({
          userId: session.user.id,
          organizationId: invite.organizationId,
          displayName: session.user.name,
          displayEmail: session.user.email,
        });
      } catch (err) {
        // Non-fatal — capture and continue. Lazy backfill will recover
        // on the user's next session resolution. PostHog signal lets
        // operators catch systemic provisioning regressions (bad
        // migration, schema drift, Prisma constraint violation) before
        // users start complaining about missing personal workspaces.
        captureException(toError(err), {
          extra: {
            origin: "governance.acceptInvite",
            userId: session.user.id,
            organizationId: invite.organizationId,
          },
        });
      }

      void ctx.app.notifications
        .sendSlackSignupEvent({
          userName: session.user.name,
          userEmail: session.user.email,
          organizationName: invite.organization.name,
        })
        .catch(captureException);

      fireInviteAcceptedNurturingCalls({
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        organizationId: invite.organization.id,
        organizationName: invite.organization.name,
      });

      const inviteService = InviteService.create(prisma, { mailer: ctx.app.mailer });
      const projectSlug = await inviteService.findLandingProjectSlug(invite);

      return {
        success: true,
        invite,
        project: projectSlug ? { slug: projectSlug } : null,
      };
    }),
  updateTeamMemberRole: protectedProcedure
    .input(
      z
        .object({
          teamId: z.string(),
          userId: z.string(),
          role: teamRoleInputSchema,
          customRoleId: z.string().optional(),
        })
        .superRefine((data, ctx) => {
          const hasCustom = isCustomRole(data.role);

          if (hasCustom) {
            if (!data.customRoleId || data.customRoleId.trim() === "") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "customRoleId is required when using a custom role",
                path: ["customRoleId"],
              });
            }
          } else {
            if (data.customRoleId !== undefined) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "customRoleId must not be provided when using a built-in role",
                path: ["customRoleId"],
              });
            }
          }
        }),
    )
    .permission("organization:manage", { via: "teamId" })
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      await assertNoPersonalTeamScope({
        client: prisma,
        scopes: [{ scopeType: RoleBindingScopeType.TEAM, scopeId: input.teamId }],
      });
      const inputIsCustomRole = isCustomRole(input.role);

      if (inputIsCustomRole && input.customRoleId) {
        // Check enterprise plan before allowing custom role assignment
        const teamForPlanCheck = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        });
        if (!teamForPlanCheck) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }
        await assertEnterprisePlan({
          planProvider: ctx.app.planProvider,
          organizationId: teamForPlanCheck.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      } else if (!inputIsCustomRole) {
        // Built-in role path: check license limits for EXTERNAL users
        const team = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }

        const orgMembership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          if (
            !isTeamRoleAllowedForOrganizationRole({
              organizationRole: OrganizationUserRole.EXTERNAL,
              teamRole: input.role as TeamRoleValue,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: LITE_MEMBER_VIEWER_ONLY_ERROR,
            });
          }

          const currentBinding = await ctx.app.roles.tryGetUserBinding({
            userId: input.userId,
            organizationId: team.organizationId,
            teamId: input.teamId,
          });

          const oldPermissions = currentBinding?.customRoleId
            ? await (async () => {
                const role = await ctx.app.roles.tryGet({
                  roleId: currentBinding.customRoleId,
                });
                return role?.permissions as string[] | undefined;
              })()
            : undefined;

          const changeType = getRoleChangeType(
            OrganizationUserRole.EXTERNAL,
            oldPermissions,
            OrganizationUserRole.EXTERNAL,
            undefined,
          );

          const subscriptionLimits = await ctx.app.planProvider.getActivePlan({
            organizationId: team.organizationId,
            user: ctx.session.user,
          });
          const licenseRepo = new LicenseEnforcementRepository(prisma);
          await assertMemberTypeLimitNotExceeded(
            changeType,
            team.organizationId,
            licenseRepo,
            subscriptionLimits,
          );
        }
      }

      await ctx.app.organizations.updateTeamMemberRole({
        teamId: input.teamId,
        userId: input.userId,
        role: input.role,
        customRoleId: input.customRoleId,
        currentUserId: ctx.session.user.id,
      });

      return { success: true };
    }),
  getAllOrganizationMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    // Tightened from organization:view to manage — full member list
    // with PII (emails) is admin-surface data. No TS callers currently
    // depend on this procedure; documented here so a future picker
    // UX that needs member names knows to use a basic-view variant
    // rather than re-loosening the permission.
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      return ctx.app.organizations.getAllMembers(input.organizationId);
    }),
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        organizationId: z.string(),
        role: z.nativeEnum(OrganizationUserRole),
        teamRoleUpdates: z
          .array(
            z.object({
              teamId: z.string(),
              userId: z.string(),
              role: teamRoleInputSchema,
              customRoleId: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      // The whole orchestration (personal-workspace assertion, shared-team
      // scoping, seat classification, Enterprise gate for custom roles)
      // lives in the service so the REST surface runs the same rules.
      const { teamsLeftWithoutAdmin } = await ctx.app.organizations.changeMemberRole({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        teamRoleUpdates: input.teamRoleUpdates,
        currentUserId: ctx.session.user.id,
        planUser: ctx.session.user,
      });

      // Reported rather than refused: correcting a seat down to Viewer can take
      // away a shared team's only team-scoped admin, which is allowed because
      // organization admins administer every shared team anyway. Naming the
      // teams is what keeps the decision from being a silent one.
      return { success: true, teamsLeftWithoutAdmin };
    }),

  getAuditLogs: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string().optional(),
        userId: z.string().optional(),
        pageOffset: z.number().min(0).default(0),
        pageSize: z.number().min(1).max(10000).default(25),
        action: z.string().optional(),
        startDate: z.number().optional(),
        endDate: z.number().optional(),
        // Gateway deep-link filters — forwarded to the UNION query so a
        // VK/budget detail page can link operators straight to the
        // pre-filtered history of that resource.
        targetKind: z.string().optional(),
        targetId: z.string().optional(),
      }),
    )
    .use(checkAuditLogPermission())
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        planProvider: ctx.app.planProvider,
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
      });

      return ctx.app.organizations.getAuditLogs({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        pageOffset: input.pageOffset,
        pageSize: input.pageSize,
        action: input.action,
        startDate: input.startDate,
        endDate: input.endDate,
        targetKind: input.targetKind,
        targetId: input.targetId,
      });
    }),
});
