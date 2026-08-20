import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/../ee/billing/nurturing/hooks/inviteAcceptance";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import { enrichTeamWithRoleBindings } from "~/server/app-layer/organizations/organization.service";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import { trackServerEvent } from "~/server/posthog";
import { RoleService } from "~/server/role/role.service";
import { assertNoPersonalTeamScope } from "~/server/role-bindings/personal-team-scope";
import { signUpDataSchema } from "~/server/schemas/sign-up-data.schema";
import { decrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  DuplicateInviteError,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteNotFoundError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import { InviteService } from "../../invites/invite.service";
import { LimitExceededError } from "../../license-enforcement/errors";
import { LicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";
import {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "../../license-enforcement/license-limit-guard";
import { getRoleChangeType } from "../../license-enforcement/member-classification";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";
import { batchScopePermissions, hasOrganizationPermission } from "../rbac";

const customTeamRoleInputSchema = z
  .string()
  .regex(
    /^custom:[a-zA-Z0-9_-]+$/,
    "Custom role must be in format 'custom:{roleId}'",
  );
const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);
const teamRoleInputSchema = z.union([
  builtInTeamRoleInputSchema,
  customTeamRoleInputSchema,
]);

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
      const result = await getApp().organizations.createAndAssign({
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
      await getApp().organizations.deleteMember({
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
        await getApp().organizations.setMemberDisabled({
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

      const organizations = (await getApp().organizations.getAllForUser({
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
          ? await new PrismaRoleBindingRepository(
              ctx.prisma,
            ).listForOrganizationsAndUser({ orgIds, userId })
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
        const canManage = await hasOrganizationPermission(
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

        const { projects: updatableProjects } = await batchScopePermissions(
          ctx,
          {
            organizationId: organization.id,
            teamIds: [],
            projectIds,
            projectTeamId,
            permission: "project:update",
          },
        );
        updatableProjectsByOrg.set(organization.id, updatableProjects);
      }

      for (const organization of organizations) {
        const canManage = manageableOrgIds.has(organization.id);
        for (const project of organization.teams.flatMap(
          (team) => team.projects,
        )) {
          if (project.s3AccessKeyId) {
            project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
          }
          project.s3SecretAccessKey =
            canManage && project.s3SecretAccessKey
              ? decrypt(project.s3SecretAccessKey)
              : null;
          if (project.s3Endpoint) {
            project.s3Endpoint = decrypt(project.s3Endpoint);
          }
          // The base key is a project-level write credential. Same rule as the
          // S3 secret above: send it only to those who can change the project,
          // rather than relying on the UI not to render it. Demo projects
          // expose it to no one.
          const canUpdateProject =
            updatableProjectsByOrg.get(organization.id)?.get(project.id) ??
            false;
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
          (member) =>
            member.userId === userId || member.userId === demoProjectUserId,
        );
        if (organization.s3AccessKeyId) {
          organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
        }
        organization.s3SecretAccessKey =
          manageableOrgIds.has(organization.id) &&
          organization.s3SecretAccessKey
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
            (member) =>
              member.userId === userId || member.userId === demoProjectUserId,
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
          // getApp().organizations is wrapped by traced() which would turn this
          // sync call into a Promise and silently drop team.members.
          const enriched = enrichTeamWithRoleBindings(
            team,
            userId,
            userRoleBindings,
            organization.id,
          );
          team.members = enriched.members;

          if (isDemoOrg) return true;
          return isExternal
            ? team.members.some((member) => member.userId === userId)
            : true;
        });

        if (isDemoOrg) {
          organization.teams = organization.teams.flatMap((team) => {
            if (team.projects.some((project) => project.id === demoProjectId)) {
              team.projects = team.projects.filter(
                (project) => project.id === demoProjectId,
              );

              team.members = team.members.filter(
                (member) =>
                  member.userId === demoProjectUserId ||
                  member.userId === userId,
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
          primaryIntent: z
            .enum(["AGENT_GOVERNANCE", "LLM_OPS"])
            .nullable()
            .optional(),
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
    .mutation(async ({ input }) => {
      // The settings form round-trips every S3 field on save, so an absent
      // credential means "clear it". `updateSettings` is a partial update
      // where absent means "leave it alone", so the clearing is made
      // explicit here. `s3Bucket` keeps its historical leave-alone-if-absent
      // behavior. The ADR-057 trace-sharing disable cascade (revoke every
      // existing trace link across the org) lives in the service.
      await getApp().organizations.updateSettings({
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
      const organization =
        await getApp().organizations.getOrganizationWithMembers({
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
      const callerHasManage = await hasOrganizationPermission(
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
      const member = await getApp().organizations.getMemberById({
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
        (invite.teams ?? []).some(
          (t) => typeof t.role === "string" && isCustomRole(t.role),
        ),
      );
      if (hasCustomRoleInvite) {
        await assertEnterprisePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const inviteService = InviteService.create(ctx.prisma);

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
          });
        }
        throw error;
      }

      if (created.invites.length > 0) {
        trackServerEvent({
          userId: ctx.session.user.id,
          event: "team_member_invited",
          properties: { inviteCount: created.invites.length },
        });

        const memberCount =
          created.organization.members.length + created.invites.length;
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
      const inviteService = InviteService.create(ctx.prisma);
      await inviteService.revokeInvite({
        organizationId: input.organizationId,
        inviteId: input.inviteId,
      });
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
      const inviteService = InviteService.create(ctx.prisma);
      return inviteService.listInvites({
        organizationId: input.organizationId,
      });
    }),
  createInviteRequest: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            role: z.enum(["MEMBER", "EXTERNAL"]),
            teamIds: z.string().optional(),
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: z.union([
                    z.nativeEnum(TeamUserRole),
                    z
                      .string()
                      .regex(
                        /^custom:[a-zA-Z0-9_-]+$/,
                        "Custom role must be in format 'custom:{roleId}'",
                      ),
                  ]),
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleInvite = input.invites.some((invite) =>
        (invite.teams ?? []).some(
          (t) => typeof t.role === "string" && isCustomRole(t.role),
        ),
      );
      if (hasCustomRoleInvite) {
        await assertEnterprisePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Check license limits for all invites at once
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: input.invites.map((invite) => ({
            role: invite.role as OrganizationUserRole,
            teams: invite.teams,
          })),
          user: ctx.session.user,
        });

        const normalizedPayloadEmails = input.invites.map((invite) =>
          invite.email.trim().toLowerCase(),
        );
        const duplicatePayloadEmails = normalizedPayloadEmails.filter(
          (email, index) => normalizedPayloadEmails.indexOf(email) !== index,
        );

        if (duplicatePayloadEmails.length > 0) {
          const uniqueDuplicatePayloadEmails = [
            ...new Set(duplicatePayloadEmails),
          ];
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate emails in request payload: ${uniqueDuplicatePayloadEmails.join(", ")}`,
          });
        }

        const preparedInvites = await Promise.all(
          input.invites.map(async (invite) => {
            const normalizedEmail = invite.email.trim().toLowerCase();

            // Validate team IDs
            let teamIdsString = "";
            let teamAssignments: Array<{
              teamId: string;
              role: TeamUserRole;
              customRoleId?: string;
            }> = [];

            if (invite.teams && invite.teams.length > 0) {
              const teamIds = invite.teams.map((t) => t.teamId);
              const validTeamIds = await inviteService.validateTeamIds({
                teamIds,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = invite.teams
                .filter((t) => validTeamIds.includes(t.teamId))
                .map((t) => {
                  const hasCustom =
                    typeof t.role === "string" && isCustomRole(t.role);
                  return {
                    teamId: t.teamId,
                    role: hasCustom
                      ? ("CUSTOM" as TeamUserRole)
                      : (t.role as TeamUserRole),
                    customRoleId:
                      hasCustom && t.customRoleId ? t.customRoleId : undefined,
                  };
                });

              // Validate custom role IDs belong to this organization and are user-assignable
              const customRoleIds = teamAssignments
                .filter((t) => t.customRoleId)
                .map((t) => t.customRoleId!);
              if (customRoleIds.length > 0) {
                const validCustomRoles = await prisma.customRole.findMany({
                  where: {
                    id: { in: customRoleIds },
                    organizationId: input.organizationId,
                    kind: "custom",
                  },
                  select: { id: true },
                });
                const validCustomRoleIds = new Set(
                  validCustomRoles.map((r) => r.id),
                );
                const invalidRoleIds = customRoleIds.filter(
                  (id) => !validCustomRoleIds.has(id),
                );
                if (invalidRoleIds.length > 0) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Custom role(s) ${invalidRoleIds.join(", ")} not found in this organization`,
                  });
                }
              }

              teamIdsString = validTeamIds.join(",");
            } else if (invite.teamIds?.trim()) {
              const teamIdArray = invite.teamIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

              const validTeamIds = await inviteService.validateTeamIds({
                teamIds: teamIdArray,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = validTeamIds.map((teamId) => ({
                teamId,
                role: ORGANIZATION_TO_TEAM_ROLE_MAP[
                  invite.role as OrganizationUserRole
                ],
              }));

              teamIdsString = validTeamIds.join(",");
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "At least one team must be provided",
              });
            }

            return {
              email: normalizedEmail,
              role: invite.role as OrganizationUserRole,
              organizationId: input.organizationId,
              teamIds: teamIdsString,
              teamAssignments:
                teamAssignments.length > 0 ? teamAssignments : undefined,
              requestedBy: ctx.session.user.id,
            };
          }),
        );

        const results = await prisma.$transaction(async (tx) => {
          const transactionalInviteService = InviteService.create(tx);
          return Promise.all(
            preparedInvites.map((invite) =>
              transactionalInviteService.createMemberInviteRequest(invite),
            ),
          );
        });

        return results;
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
          });
        }
        if (error instanceof DuplicateInviteError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  approveInvite: protectedProcedure
    .input(
      z.object({
        inviteId: z.string(),
        organizationId: z.string(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Re-validate license limits before approving (org may have reached cap since request)
        const invite = await prisma.organizationInvite.findFirst({
          where: {
            id: input.inviteId,
            organizationId: input.organizationId,
            status: "WAITING_APPROVAL",
          },
        });

        if (!invite) {
          throw new InviteNotFoundError();
        }

        const teamAssignments =
          (invite.teamAssignments as Array<{ customRoleId?: string }>) ?? [];
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: [{ role: invite.role, teams: teamAssignments }],
          user: ctx.session.user,
        });

        return await inviteService.approveInvite({
          inviteId: input.inviteId,
          organizationId: input.organizationId,
        });
      } catch (error) {
        if (
          error instanceof InviteNotFoundError ||
          error instanceof OrganizationNotFoundError
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
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
          });
        }
        throw error;
      }
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

      if (
        !invite ||
        (invite.expiration !== null && invite.expiration < new Date())
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found or has expired",
        });
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

      if (invite.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_NOT_READY_MESSAGE,
        });
      }

      // Case-insensitive email comparison: BetterAuth lowercases emails
      // during signup/signin (see `findUserByEmail` in
      // node_modules/better-auth/dist/db/internal-adapter.mjs) so
      // `session.user.email` is always lowercase, but `invite.email`
      // preserves the admin's original casing. A strict `!==` would
      // reject an "Alice@Acme.com" invite for an "alice@acme.com" user.
      // The old NextAuth flow worked accidentally because it didn't
      // lowercase emails either — this is now a real mismatch post-migration.
      if (
        session.user.email.toLowerCase() !== invite.email.trim().toLowerCase()
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The invite was sent to ${invite.email}, but you are signed in as ${session.user.email}`,
        });
      }

      // No transaction: the invite's grants are ledger commands, so the
      // membership row has to be committed before they are emitted, and the
      // invite is only marked ACCEPTED once everything before it has landed
      // (a still-PENDING invite is one still to apply).
      await InviteService.create(prisma).applyInvite({
        userId: session.user.id,
        invite,
      });

      // Provision the user's Personal Workspace (Team.isPersonal +
      // Project.isPersonal) for this org. Idempotent — safe if a prior
      // invite already triggered it. Runs outside the invite tx so an
      // unexpected failure here doesn't roll the membership back; the
      // next login will retry via the lazy backfill in
      // `user.personalContext`.
      try {
        const personalWorkspaceService = new PersonalWorkspaceService(prisma);
        await personalWorkspaceService.ensure({
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

      void getApp()
        .notifications.sendSlackSignupEvent({
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

      const inviteService = InviteService.create(prisma);
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
                message:
                  "customRoleId must not be provided when using a built-in role",
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
        scopes: [
          { scopeType: RoleBindingScopeType.TEAM, scopeId: input.teamId },
        ],
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

          const roleService = new RoleService(prisma);
          const currentBinding = await roleService.getUserCustomRoleBinding({
            userId: input.userId,
            organizationId: team.organizationId,
            teamId: input.teamId,
          });

          const oldPermissions = currentBinding?.customRoleId
            ? await (async () => {
                const role = await roleService.getRoleByIdOrNull(
                  currentBinding.customRoleId!,
                );
                return role?.permissions as string[] | undefined;
              })()
            : undefined;

          const changeType = getRoleChangeType(
            OrganizationUserRole.EXTERNAL,
            oldPermissions,
            OrganizationUserRole.EXTERNAL,
            undefined,
          );

          const subscriptionLimits = await getApp().planProvider.getActivePlan({
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

      await getApp().organizations.updateTeamMemberRole({
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
    .query(async ({ input }) => {
      return getApp().organizations.getAllMembers(input.organizationId);
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
      const { teamsLeftWithoutAdmin } =
        await getApp().organizations.changeMemberRole({
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
    .permission("auditLog:view")
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
      });

      return getApp().organizations.getAuditLogs({
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
