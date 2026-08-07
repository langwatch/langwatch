import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { OrganizationInvite, Prisma, PrismaClient } from "@prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/../ee/billing/nurturing/hooks/inviteAcceptance";
import { env } from "~/env.mjs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import { enrichTeamWithRoleBindings } from "~/server/app-layer/organizations/organization.service";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import type { RoleBindingForSynthesis } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";
import type { Session } from "~/server/auth";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { trackServerEvent } from "~/server/posthog";
import { RoleService } from "~/server/role/role.service";
import {
  assertNoPersonalTeamScope,
  findSharedTeamIds,
} from "~/server/role-bindings/personal-team-scope";
import { signUpDataSchema } from "~/server/schemas/sign-up-data.schema";
import { decrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import {
  DuplicateInviteError,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteNotFoundError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import {
  InviteService,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "../../invites/invite.service";
import { LimitExceededError } from "../../license-enforcement/errors";
import { LicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";
import {
  assertMemberTypeLimitNotExceeded,
  LICENSE_LIMIT_ERRORS,
} from "../../license-enforcement/license-limit-guard";
import { getRoleChangeType } from "../../license-enforcement/member-classification";
import {
  assertEnterprisePlan,
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";
import {
  batchScopePermissions,
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
  skipPermissionCheck,
} from "../rbac";

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

/**
 * Which orgs the caller can manage, and — for `getAll`'s per-project base-key
 * redaction — which projects in each org the caller can update. One batched
 * resolution per org, not one check per project: a scoped check is ~4
 * queries, so a per-project fan-out would scale with the org's project count.
 */
async function resolveOrgAccessMaps({
  ctx,
  organizations,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  organizations: FullyLoadedOrganization[];
}): Promise<{
  manageableOrgIds: Set<string>;
  updatableProjectsByOrg: Map<string, Map<string, boolean>>;
}> {
  const manageableOrgIds = new Set<string>();
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

    const { projects: updatableProjects } = await batchScopePermissions(ctx, {
      organizationId: organization.id,
      teamIds: [],
      projectIds,
      projectTeamId,
      permission: "project:update",
    });
    updatableProjectsByOrg.set(organization.id, updatableProjects);
  }
  return { manageableOrgIds, updatableProjectsByOrg };
}

/**
 * Decrypts one project's S3 fields (the secret key only when `canManage`)
 * and blanks the project API key — a project-level write credential — for
 * a demo request or a project the caller cannot update, so the API never
 * hands it out relying on the UI not to render it.
 */
function redactProjectSecretsForOne({
  project,
  canManage,
  canUpdateProject,
  isDemo,
}: {
  project: FullyLoadedOrganization["teams"][number]["projects"][number];
  canManage: boolean;
  canUpdateProject: boolean;
  isDemo: boolean;
}): void {
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
  if (isDemo || !canUpdateProject) {
    project.apiKey = "";
  }
}

/** Applies `redactProjectSecretsForOne` to every project across every org. */
function redactProjectSecrets({
  organizations,
  manageableOrgIds,
  updatableProjectsByOrg,
  isDemo,
}: {
  organizations: FullyLoadedOrganization[];
  manageableOrgIds: Set<string>;
  updatableProjectsByOrg: Map<string, Map<string, boolean>>;
  isDemo: boolean;
}): void {
  for (const organization of organizations) {
    const canManage = manageableOrgIds.has(organization.id);
    for (const project of organization.teams.flatMap((team) => team.projects)) {
      const canUpdateProject =
        updatableProjectsByOrg.get(organization.id)?.get(project.id) ?? false;
      redactProjectSecretsForOne({
        project,
        canManage,
        canUpdateProject,
        isDemo,
      });
    }
  }
}

function filterOrganizationMembersForResponse({
  organization,
  userId,
  demoProjectUserId,
}: {
  organization: FullyLoadedOrganization;
  userId: string;
  demoProjectUserId: string;
}): void {
  organization.members = organization.members.filter(
    (member) => member.userId === userId || member.userId === demoProjectUserId,
  );
}

/** Decrypts org-level S3 fields; the secret key only for callers who can manage the org. */
function redactOrganizationSecrets({
  organization,
  manageableOrgIds,
}: {
  organization: FullyLoadedOrganization;
  manageableOrgIds: Set<string>;
}): void {
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
}

/**
 * The Organization row still carries the dead Elasticsearch columns (kept
 * for deploy safety until a follow-up migration drops them). Never ship the
 * stored ciphertext / flag to clients.
 */
function clearDeadElasticsearchFields(
  organization: FullyLoadedOrganization,
): void {
  organization.elasticsearchNodeUrl = null;
  organization.elasticsearchApiKey = null;
  organization.useCustomElasticsearch = false;
}

/**
 * A user can be an org admin via either the legacy OrganizationUser row OR
 * via an ORGANIZATION-scoped ADMIN RoleBinding (direct or via group).
 * Without this, users onboarded through the RoleBinding flow with no
 * OrganizationUser row are treated as external and lose access to every
 * team that lacks an explicit team/project binding.
 *
 * RoleBinding(scope=ORGANIZATION, role=ADMIN) is authoritative when
 * present: promotes the user's exposed role so the frontend hook
 * `useOrganizationTeamProject().organizationRole` and downstream guards
 * (`withPermissionGuard("organization:manage")`) honor it. Without this, a
 * stale `OrganizationUser.role=MEMBER` row shadows a fresh ADMIN
 * RoleBinding, gating the admin out of /governance + /settings/governance/*.
 * Backend RBAC paths already honor RoleBindings
 * (`resolveOrganizationPermission`, `requireApiKeyPermission`); this closes
 * the page-guard / SSR-only drift.
 *
 * Returns whether the promotion applied — the caller also needs it to
 * decide `isExternal`.
 */
function promoteOrgAdminViaBinding({
  organization,
  userId,
  userRoleBindings,
}: {
  organization: FullyLoadedOrganization;
  userId: string;
  userRoleBindings: RoleBindingForSynthesis[];
}): boolean {
  const isOrgAdminViaBinding = userRoleBindings.some(
    (b) =>
      b.organizationId === organization.id &&
      b.scopeType === RoleBindingScopeType.ORGANIZATION &&
      b.role === TeamUserRole.ADMIN,
  );
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
  return isOrgAdminViaBinding;
}

/**
 * RoleBinding is authoritative for team membership and role. Always prefer
 * a team-scoped RoleBinding over any stale TeamUser row, since dual-writes
 * to TeamUser have been removed. Org-scoped bindings are intentionally
 * excluded: org MEMBER/VIEWER bindings only grant organization:view — they
 * don't give team-level access. Org admins are handled by the
 * `organizationRole === ADMIN` shortcut in the frontend hasPermission and
 * backend resolveTeamPermission.
 *
 * NOTE: `enrichTeamWithRoleBindings` is a standalone function (not a
 * service method) because getApp().organizations is wrapped by traced()
 * which would turn this sync call into a Promise and silently drop
 * team.members.
 */
function filterOrganizationTeamsForResponse({
  organization,
  userId,
  demoProjectUserId,
  userRoleBindings,
  isDemoOrg,
  isExternal,
}: {
  organization: FullyLoadedOrganization;
  userId: string;
  demoProjectUserId: string;
  userRoleBindings: RoleBindingForSynthesis[];
  isDemoOrg: boolean;
  isExternal: boolean;
}): void {
  organization.teams = organization.teams.filter((team) => {
    team.members = team.members.filter(
      (member) =>
        member.userId === userId || member.userId === demoProjectUserId,
    );

    const enriched = enrichTeamWithRoleBindings({
      team,
      userId,
      userRoleBindings,
      organizationId: organization.id,
    });
    team.members = enriched.members;

    if (isDemoOrg) return true;
    return isExternal
      ? team.members.some((member) => member.userId === userId)
      : true;
  });
}

/** For a demo org, keep only the demo project (and only the demo/actual users) on each of its teams. */
function restrictOrganizationToDemoProject({
  organization,
  demoProjectUserId,
  demoProjectId,
  userId,
}: {
  organization: FullyLoadedOrganization;
  demoProjectUserId: string;
  demoProjectId: string;
  userId: string;
}): void {
  organization.teams = organization.teams.flatMap((team) => {
    if (team.projects.some((project) => project.id === demoProjectId)) {
      team.projects = team.projects.filter(
        (project) => project.id === demoProjectId,
      );
      team.members = team.members.filter(
        (member) =>
          member.userId === demoProjectUserId || member.userId === userId,
      );
      return [team];
    }
    return [];
  });
}

/** Applies every per-org redaction/filtering step `getAll` needs, in order, mutating `organization` in place. */
function processOrganizationForResponse({
  organization,
  userId,
  demoProjectUserId,
  demoProjectId,
  isDemo,
  userRoleBindings,
  manageableOrgIds,
}: {
  organization: FullyLoadedOrganization;
  userId: string;
  demoProjectUserId: string;
  demoProjectId: string;
  isDemo: boolean;
  userRoleBindings: RoleBindingForSynthesis[];
  manageableOrgIds: Set<string>;
}): void {
  const isDemoOrg =
    isDemo &&
    organization.teams.some((team) =>
      team.projects.some((project) => project.id === demoProjectId),
    );

  filterOrganizationMembersForResponse({
    organization,
    userId,
    demoProjectUserId,
  });
  redactOrganizationSecrets({ organization, manageableOrgIds });
  clearDeadElasticsearchFields(organization);

  const isOrgAdminViaBinding = promoteOrgAdminViaBinding({
    organization,
    userId,
    userRoleBindings,
  });
  const isExternal =
    !isOrgAdminViaBinding &&
    organization.members[0]?.role !== "ADMIN" &&
    organization.members[0]?.role !== "MEMBER";

  filterOrganizationTeamsForResponse({
    organization,
    userId,
    demoProjectUserId,
    userRoleBindings,
    isDemoOrg,
    isExternal,
  });

  if (isDemoOrg) {
    restrictOrganizationToDemoProject({
      organization,
      demoProjectUserId,
      demoProjectId,
      userId,
    });
  }
}

/**
 * PII guard for picker callers: when the caller doesn't have
 * organization:manage, null out other members' emails AND strip their
 * personal-workspace teamMemberships (existence of someone else's personal
 * workspace is itself private). The caller's own email + own personal
 * workspace stay visible.
 */
function redactOtherMembersPii({
  organization,
  callerId,
}: {
  organization: {
    members?: Array<{
      user: {
        id: string;
        email: string | null;
        teamMemberships?: Array<{
          team: { isPersonal: boolean; ownerUserId: string | null };
        }>;
      };
    }>;
  };
  callerId: string;
}): void {
  for (const m of organization.members ?? []) {
    if (m.user.id !== callerId) {
      m.user.email = null;
    }
    // Drop teamMembership rows that point at someone else's personal
    // workspace. The caller's own personal workspace stays even when
    // iterating someone else's memberships (it's their team too — they
    // belong to it).
    if (m.user.teamMemberships) {
      m.user.teamMemberships = m.user.teamMemberships.filter((tm) => {
        if (!tm.team.isPersonal) return true;
        return tm.team.ownerUserId === callerId;
      });
    }
  }
}

type PreparedTeamAssignment = {
  teamId: string;
  role: TeamUserRole;
  customRoleId?: string;
};

/**
 * Resolves an admin invite's explicit `teams` (the per-team role assignment
 * shape) into validated team assignments + the legacy `teamIds` CSV string,
 * filtering out teams that don't exist in this org and custom-role
 * assignments that don't validate. Returns null when nothing valid remains
 * — the caller skips the invite entirely, same as an invalid legacy
 * `teamIds`.
 */
async function resolveAdminInviteTeamsFromExplicitTeams({
  prisma,
  organizationId,
  teams,
}: {
  prisma: PrismaClient;
  organizationId: string;
  teams: Array<{
    teamId: string;
    role: TeamUserRole | string;
    customRoleId?: string;
  }>;
}): Promise<{
  teamAssignments: PreparedTeamAssignment[];
  teamIdsString: string;
} | null> {
  const teamIds = teams.map((t) => t.teamId);

  const validTeams = await prisma.team.findMany({
    where: { id: { in: teamIds }, organizationId },
    select: { id: true },
  });
  const validTeamIds = validTeams.map((team) => team.id);
  if (validTeamIds.length === 0) return null;

  const teamAssignments = teams
    .filter((t) => validTeamIds.includes(t.teamId))
    .map((t) => {
      const hasCustom = typeof t.role === "string" && isCustomRole(t.role);
      return {
        teamId: t.teamId,
        role: hasCustom ? TeamUserRole.CUSTOM : (t.role as TeamUserRole),
        customRoleId: hasCustom && t.customRoleId ? t.customRoleId : undefined,
      };
    })
    .filter((t) => !(t.role === TeamUserRole.CUSTOM && !t.customRoleId));

  // Validate custom role IDs belong to this organization
  const customRoleIds = teamAssignments
    .filter((t) => t.customRoleId)
    .map((t) => t.customRoleId!);
  if (customRoleIds.length > 0) {
    const validCustomRoles = await prisma.customRole.findMany({
      where: { id: { in: customRoleIds }, organizationId, kind: "custom" },
      select: { id: true },
    });
    const validCustomRoleIds = new Set(validCustomRoles.map((r) => r.id));
    const invalidRoleIds = customRoleIds.filter(
      (id) => !validCustomRoleIds.has(id),
    );
    if (invalidRoleIds.length > 0) return null; // Skip this invite — invalid custom role
  }

  return { teamAssignments, teamIdsString: validTeamIds.join(",") };
}

/** Resolves the legacy `teamIds` CSV field, all under the invite's org-level role mapped down to a team role. */
async function resolveAdminInviteTeamsFromLegacyTeamIds({
  prisma,
  organizationId,
  teamIdsCsv,
  role,
}: {
  prisma: PrismaClient;
  organizationId: string;
  teamIdsCsv: string;
  role: OrganizationUserRole;
}): Promise<{
  teamAssignments: PreparedTeamAssignment[];
  teamIdsString: string;
} | null> {
  const teamIdArray = teamIdsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const validTeams = await prisma.team.findMany({
    where: { id: { in: teamIdArray }, organizationId },
    select: { id: true },
  });
  const validTeamIds = validTeams.map((team) => team.id);
  if (validTeamIds.length === 0) return null;

  const teamAssignments = validTeamIds.map((teamId) => ({
    teamId,
    role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
  }));

  return { teamAssignments, teamIdsString: validTeamIds.join(",") };
}

/**
 * Prepares one admin-created invite: resolves its team assignments
 * (explicit `teams`, falling back to the legacy `teamIds` CSV), then shapes
 * the row `createInvites` writes. Returns null to skip the invite when
 * validation fails — read-only, so this runs before the write transaction.
 */
async function prepareAdminInvite({
  prisma,
  organizationId,
  invite,
}: {
  prisma: PrismaClient;
  organizationId: string;
  invite: {
    email: string;
    role: OrganizationUserRole;
    teamIds?: string;
    teams?: Array<{
      teamId: string;
      role: TeamUserRole | string;
      customRoleId?: string;
    }>;
  };
}): Promise<{
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments: PreparedTeamAssignment[] | undefined;
} | null> {
  const resolved =
    invite.teams && invite.teams.length > 0
      ? await resolveAdminInviteTeamsFromExplicitTeams({
          prisma,
          organizationId,
          teams: invite.teams,
        })
      : invite.teamIds?.trim()
        ? await resolveAdminInviteTeamsFromLegacyTeamIds({
            prisma,
            organizationId,
            teamIdsCsv: invite.teamIds,
            role: invite.role,
          })
        : null;

  if (!resolved) return null;
  if (!invite.email.trim()) return null;

  return {
    email: invite.email,
    role: invite.role,
    organizationId,
    teamIds: resolved.teamIdsString,
    teamAssignments:
      resolved.teamAssignments.length > 0
        ? resolved.teamAssignments
        : undefined,
  };
}

/** Custom-role team assignments on an admin-created invite require the enterprise plan. */
async function assertAdminInvitesAllowCustomRoles({
  invites,
  organizationId,
  actorUser,
}: {
  invites: Array<{ teams?: Array<{ role: TeamUserRole | string }> }>;
  organizationId: string;
  actorUser: PlanProviderUser;
}): Promise<void> {
  const hasCustomRoleInvite = invites.some((invite) =>
    (invite.teams ?? []).some(
      (t) => typeof t.role === "string" && isCustomRole(t.role),
    ),
  );
  if (!hasCustomRoleInvite) return;
  await assertEnterprisePlan({
    organizationId,
    user: actorUser,
    errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
  });
}

/**
 * License-limit check for a batch of admin-created invites. On a limit
 * breach, fires the resource-limit notification (best-effort) and
 * re-throws as the FORBIDDEN the client's limit modal expects; any other
 * error propagates unchanged.
 */
async function assertAdminInviteLicenseLimits({
  inviteService,
  organizationId,
  invites,
  actorUser,
}: {
  inviteService: InviteService;
  organizationId: string;
  invites: Array<{
    role: OrganizationUserRole;
    teams?: Array<{
      teamId: string;
      role: TeamUserRole | string;
      customRoleId?: string;
    }>;
  }>;
  actorUser: PlanProviderUser;
}): Promise<void> {
  try {
    await inviteService.checkLicenseLimits({
      organizationId,
      newInvites: invites.map((invite) => ({
        role: invite.role,
        teams: invite.teams,
      })),
      user: actorUser,
    });
  } catch (error) {
    if (error instanceof LimitExceededError) {
      void getApp()
        .usageLimits.notifyResourceLimitReached({
          organizationId,
          limitType: error.limitType,
          current: error.current,
          max: error.max,
        })
        .catch(captureException);

      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
}

/** Phase 1: creates each valid invite's DB record inside a transaction, skipping one whose email already has a pending invite. */
async function createAdminInviteRecords({
  prisma,
  validInvites,
}: {
  prisma: PrismaClient;
  validInvites: Array<
    NonNullable<Awaited<ReturnType<typeof prepareAdminInvite>>>
  >;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const txInviteService = InviteService.create(tx);
    return Promise.all(
      validInvites.map(async (invite) => {
        const existingInvite = await txInviteService.checkDuplicateInvite({
          email: invite.email,
          organizationId: invite.organizationId,
        });

        if (existingInvite) {
          return null;
        }

        return await txInviteService.createAdminInviteRecord(invite);
      }),
    );
  });
}

/** Phase 2 side effects: analytics + nurturing calls, fired only when at least one invite record was actually created. */
function fireAdminInviteCreatedSideEffects({
  actorUserId,
  organization,
  createdRecords,
}: {
  actorUserId: string;
  organization: { members: unknown[] };
  createdRecords: Array<{ invite: { role: OrganizationUserRole } }>;
}): void {
  if (createdRecords.length === 0) return;

  trackServerEvent({
    userId: actorUserId,
    event: "team_member_invited",
    properties: { inviteCount: createdRecords.length },
  });

  const memberCount = organization.members.length + createdRecords.length;
  for (const record of createdRecords) {
    fireTeamMemberInvitedNurturing({
      userId: actorUserId,
      teamMemberCount: memberCount,
      role: record.invite.role,
    });
  }
}

/** Sends each created invite's email (best-effort — failures surface as `emailNotSent`, not a throw). */
async function sendAdminInviteEmails({
  inviteService,
  createdRecords,
}: {
  inviteService: InviteService;
  createdRecords: Array<
    NonNullable<Awaited<ReturnType<typeof createAdminInviteRecords>>[number]>
  >;
}) {
  return Promise.all(
    createdRecords.map(async (record) => {
      const { emailNotSent } = await inviteService.trySendInviteEmail({
        email: record.invite.email,
        organization: record.organization,
        inviteCode: record.invite.inviteCode,
      });
      return { invite: record.invite, emailNotSent };
    }),
  );
}

/** No two invites in the SAME request may target the same email — throws BAD_REQUEST naming the offenders. */
function assertNoDuplicatePayloadEmails(
  invites: Array<{ email: string }>,
): void {
  const normalizedPayloadEmails = invites.map((invite) =>
    invite.email.trim().toLowerCase(),
  );
  const duplicatePayloadEmails = normalizedPayloadEmails.filter(
    (email, index) => normalizedPayloadEmails.indexOf(email) !== index,
  );

  if (duplicatePayloadEmails.length > 0) {
    const uniqueDuplicatePayloadEmails = [...new Set(duplicatePayloadEmails)];
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Duplicate emails in request payload: ${uniqueDuplicatePayloadEmails.join(", ")}`,
    });
  }
}

/**
 * Resolves a self-service invite request's explicit `teams`, throwing
 * BAD_REQUEST when nothing valid remains or a custom role doesn't check
 * out — unlike the admin path, an invalid team/role here is a rejected
 * request, not a silently-skipped invite.
 */
async function resolveInviteRequestTeamsFromExplicitTeams({
  inviteService,
  prisma,
  organizationId,
  teams,
}: {
  inviteService: InviteService;
  prisma: PrismaClient;
  organizationId: string;
  teams: Array<{
    teamId: string;
    role: TeamUserRole | string;
    customRoleId?: string;
  }>;
}): Promise<{
  teamAssignments: PreparedTeamAssignment[];
  teamIdsString: string;
}> {
  const teamIds = teams.map((t) => t.teamId);
  const validTeamIds = await inviteService.validateTeamIds({
    teamIds,
    organizationId,
  });

  if (validTeamIds.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No valid teams provided",
    });
  }

  const teamAssignments = teams
    .filter((t) => validTeamIds.includes(t.teamId))
    .map((t) => {
      const hasCustom = typeof t.role === "string" && isCustomRole(t.role);
      return {
        teamId: t.teamId,
        role: hasCustom ? TeamUserRole.CUSTOM : (t.role as TeamUserRole),
        customRoleId: hasCustom && t.customRoleId ? t.customRoleId : undefined,
      };
    });

  // Validate custom role IDs belong to this organization and are user-assignable
  const customRoleIds = teamAssignments
    .filter((t) => t.customRoleId)
    .map((t) => t.customRoleId!);
  if (customRoleIds.length > 0) {
    const validCustomRoles = await prisma.customRole.findMany({
      where: { id: { in: customRoleIds }, organizationId, kind: "custom" },
      select: { id: true },
    });
    const validCustomRoleIds = new Set(validCustomRoles.map((r) => r.id));
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

  return { teamAssignments, teamIdsString: validTeamIds.join(",") };
}

/** Resolves a self-service invite request's legacy `teamIds` CSV field, throwing BAD_REQUEST when nothing valid remains. */
async function resolveInviteRequestTeamsFromLegacyTeamIds({
  inviteService,
  organizationId,
  teamIdsCsv,
  role,
}: {
  inviteService: InviteService;
  organizationId: string;
  teamIdsCsv: string;
  role: OrganizationUserRole;
}): Promise<{
  teamAssignments: PreparedTeamAssignment[];
  teamIdsString: string;
}> {
  const teamIdArray = teamIdsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const validTeamIds = await inviteService.validateTeamIds({
    teamIds: teamIdArray,
    organizationId,
  });

  if (validTeamIds.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No valid teams provided",
    });
  }

  const teamAssignments = validTeamIds.map((teamId) => ({
    teamId,
    role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
  }));

  return { teamAssignments, teamIdsString: validTeamIds.join(",") };
}

/**
 * Prepares one self-service invite request: resolves its team assignments
 * (explicit `teams`, falling back to the legacy `teamIds` CSV — at least
 * one is required), then shapes the row `createInviteRequest` writes.
 * Throws BAD_REQUEST on any validation failure — unlike the admin path,
 * there's no "skip this one" here.
 */
async function prepareInviteRequest({
  inviteService,
  prisma,
  organizationId,
  invite,
  requestedBy,
}: {
  inviteService: InviteService;
  prisma: PrismaClient;
  organizationId: string;
  invite: {
    email: string;
    role: string;
    teamIds?: string;
    teams?: Array<{
      teamId: string;
      role: TeamUserRole | string;
      customRoleId?: string;
    }>;
  };
  requestedBy: string;
}): Promise<{
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments: PreparedTeamAssignment[] | undefined;
  requestedBy: string;
}> {
  const normalizedEmail = invite.email.trim().toLowerCase();

  const resolved =
    invite.teams && invite.teams.length > 0
      ? await resolveInviteRequestTeamsFromExplicitTeams({
          inviteService,
          prisma,
          organizationId,
          teams: invite.teams,
        })
      : invite.teamIds?.trim()
        ? await resolveInviteRequestTeamsFromLegacyTeamIds({
            inviteService,
            organizationId,
            teamIdsCsv: invite.teamIds,
            role: invite.role as OrganizationUserRole,
          })
        : (() => {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "At least one team must be provided",
            });
          })();

  return {
    email: normalizedEmail,
    role: invite.role as OrganizationUserRole,
    organizationId,
    teamIds: resolved.teamIdsString,
    teamAssignments:
      resolved.teamAssignments.length > 0
        ? resolved.teamAssignments
        : undefined,
    requestedBy,
  };
}

/** Phase: creates each prepared invite request's DB record inside a transaction. */
async function createInviteRequestRecords({
  prisma,
  preparedInvites,
}: {
  prisma: PrismaClient;
  preparedInvites: Array<Awaited<ReturnType<typeof prepareInviteRequest>>>;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const transactionalInviteService = InviteService.create(tx);
    return Promise.all(
      preparedInvites.map((invite) =>
        transactionalInviteService.createMemberInviteRequest(invite),
      ),
    );
  });
}

/** Maps createInviteRequest failures (limit + duplicate) to the TRPCErrors the wire contract expects; anything else rethrows unchanged. */
function throwMappedInviteRequestError(
  error: unknown,
  organizationId: string,
): never {
  if (error instanceof LimitExceededError) {
    void getApp()
      .usageLimits.notifyResourceLimitReached({
        organizationId,
        limitType: error.limitType,
        current: error.current,
        max: error.max,
      })
      .catch(captureException);

    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error instanceof DuplicateInviteError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/**
 * Every guard `acceptInvite` needs before touching data, in order. Returns
 * the invite narrowed non-null plus the caller's verified email — extracted
 * as its own value (rather than relying on `session.user.email` staying
 * narrowed at the call site) since that narrowing does not survive a
 * function boundary.
 */
function requireAcceptableInvite<
  T extends { expiration: Date | null; status: string; email: string },
>({
  invite,
  session,
}: {
  invite: T | null;
  session: Session;
}): { invite: T; email: string } {
  if (
    !invite ||
    (invite.expiration !== null && invite.expiration < new Date())
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or has expired",
    });
  }

  const email = session.user.email;
  if (!email) {
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
  if (email.toLowerCase() !== invite.email.trim().toLowerCase()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `The invite was sent to ${invite.email}, but you are signed in as ${email}`,
    });
  }

  return { invite, email };
}

/** Applies the invite (membership + role bindings) inside its own transaction. */
async function applyInviteAcceptance({
  prisma,
  userId,
  invite,
}: {
  prisma: PrismaClient;
  userId: string;
  invite: OrganizationInvite;
}): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const txInviteService = InviteService.create(tx);
    await txInviteService.applyInvite({ userId, invite });
  });
}

/**
 * Best-effort: provisions the user's Personal Workspace (Team.isPersonal +
 * Project.isPersonal) for this org. Idempotent — safe if a prior invite
 * already triggered it. Runs outside the invite tx so an unexpected failure
 * here doesn't roll the membership back; the next login will retry via the
 * lazy backfill in `user.personalContext`.
 */
async function provisionPersonalWorkspaceBestEffort({
  prisma,
  session,
  email,
  organizationId,
}: {
  prisma: PrismaClient;
  session: Session;
  email: string;
  organizationId: string;
}): Promise<void> {
  try {
    const personalWorkspaceService = new PersonalWorkspaceService(prisma);
    await personalWorkspaceService.ensure({
      userId: session.user.id,
      organizationId,
      displayName: session.user.name,
      displayEmail: email,
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
        organizationId,
      },
    });
  }
}

/** Best-effort Slack + nurturing notifications once an invite has been accepted. */
function fireAcceptInviteSideEffects({
  session,
  email,
  invite,
}: {
  session: Session;
  email: string;
  invite: { organization: { id: string; name: string } };
}): void {
  void getApp()
    .notifications.sendSlackSignupEvent({
      userName: session.user.name,
      userEmail: email,
      organizationName: invite.organization.name,
    })
    .catch(captureException);

  fireInviteAcceptedNurturingCalls({
    userId: session.user.id,
    email,
    name: session.user.name,
    organizationId: invite.organization.id,
    organizationName: invite.organization.name,
  });
}

/** Custom-role team assignment requires the enterprise plan. */
async function assertCustomRoleAssignmentAllowed({
  prisma,
  teamId,
  actorUser,
}: {
  prisma: PrismaClient;
  teamId: string;
  actorUser: PlanProviderUser;
}): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });
  if (!team) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
  }
  await assertEnterprisePlan({
    organizationId: team.organizationId,
    user: actorUser,
    errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
  });
}

/**
 * Built-in role path: an EXTERNAL (Lite Member) user's team role is
 * restricted to viewer-only, and reassigning one still counts against the
 * member-type license limit the same way a fresh EXTERNAL grant would. A
 * no-op for any other org role.
 */
async function assertBuiltInRoleAssignmentAllowed({
  prisma,
  teamId,
  userId,
  role,
  actorUser,
}: {
  prisma: PrismaClient;
  teamId: string;
  userId: string;
  role: TeamRoleValue;
  actorUser: PlanProviderUser;
}): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });
  if (!team) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
  }

  const orgMembership = await prisma.organizationUser.findUnique({
    where: {
      userId_organizationId: { userId, organizationId: team.organizationId },
    },
  });

  if (orgMembership?.role !== OrganizationUserRole.EXTERNAL) return;

  if (
    !isTeamRoleAllowedForOrganizationRole({
      organizationRole: OrganizationUserRole.EXTERNAL,
      teamRole: role,
    })
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: LITE_MEMBER_VIEWER_ONLY_ERROR,
    });
  }

  const roleService = new RoleService(prisma);
  const currentBinding = await roleService.getUserCustomRoleBinding({
    userId,
    organizationId: team.organizationId,
    teamId,
  });

  const oldPermissions = currentBinding?.customRoleId
    ? await (async () => {
        const oldRole = await roleService.getRoleByIdOrNull(
          currentBinding.customRoleId!,
        );
        return oldRole?.permissions as string[] | undefined;
      })()
    : undefined;

  const changeType = getRoleChangeType({
    oldRole: OrganizationUserRole.EXTERNAL,
    oldPermissions,
    newRole: OrganizationUserRole.EXTERNAL,
    newPermissions: undefined,
  });

  const subscriptionLimits = await getApp().planProvider.getActivePlan({
    organizationId: team.organizationId,
    user: actorUser,
  });
  const licenseRepo = new LicenseEnforcementRepository(prisma);
  await assertMemberTypeLimitNotExceeded({
    changeType,
    organizationId: team.organizationId,
    licenseRepo,
    limits: subscriptionLimits,
  });
}

/**
 * Everything about the user's current shared-team membership state that
 * both the license check and the actual org-role update need.
 */
async function resolveCurrentTeamMembershipState({
  prisma,
  organizationId,
  userId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
}): Promise<{
  organizationTeamIds: string[];
  currentMemberships: Array<{ teamId: string; role: TeamUserRole }>;
  userPermissions: string[] | undefined;
}> {
  // Only the teams the organization shares. A seat decision is about the
  // person, so it applies to the teams they work in with other people and
  // leaves the workspace that is only theirs alone. Including it would ask
  // the organization to demote a team's last admin, which is refused, and
  // the whole role change would go down with the refusal.
  const organizationTeamIds = await findSharedTeamIds({
    client: prisma,
    organizationId,
  });

  const currentTeamBindings = await prisma.roleBinding.findMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: { in: organizationTeamIds },
    },
    select: { scopeId: true, role: true, customRoleId: true },
  });

  const currentMemberships = currentTeamBindings.map((b) => ({
    teamId: b.scopeId,
    role: b.role,
  }));

  const customRoleIds = currentTeamBindings
    .map((b) => b.customRoleId)
    .filter((id): id is string => !!id);
  let userPermissions: string[] | undefined;
  if (customRoleIds.length > 0) {
    const customRoles = await prisma.customRole.findMany({
      where: { id: { in: customRoleIds } },
      select: { permissions: true },
    });
    const allPermissions: string[] = [];
    for (const cr of customRoles) {
      if (cr.permissions) {
        allPermissions.push(...(cr.permissions as string[]));
      }
    }
    userPermissions = allPermissions.length > 0 ? allPermissions : undefined;
  }

  return { organizationTeamIds, currentMemberships, userPermissions };
}

/** License-limit check for the org-role change. Returns the resolved plan — the caller also needs it to gate custom-role team updates. */
async function assertMemberRoleChangeAllowed({
  prisma,
  organizationId,
  currentRole,
  userPermissions,
  newRole,
  actorUser,
}: {
  prisma: PrismaClient;
  organizationId: string;
  currentRole: OrganizationUserRole;
  userPermissions: string[] | undefined;
  newRole: OrganizationUserRole;
  actorUser: PlanProviderUser;
}): Promise<PlanInfo> {
  const changeType = getRoleChangeType({
    oldRole: currentRole,
    oldPermissions: userPermissions,
    newRole,
    newPermissions: undefined,
  });

  const subscriptionLimits = await getApp().planProvider.getActivePlan({
    organizationId,
    user: actorUser,
  });
  const licenseRepo = new LicenseEnforcementRepository(prisma);
  await assertMemberTypeLimitNotExceeded({
    changeType,
    organizationId,
    licenseRepo,
    limits: subscriptionLimits,
  });

  return subscriptionLimits;
}

/** Any custom-role team assignment in the batch requires the enterprise plan. */
function assertTeamRoleUpdatesAllowCustomRoles({
  teamRoleUpdates,
  planType,
}: {
  teamRoleUpdates: Array<{ role: TeamUserRole | string }> | undefined;
  planType: string;
}): void {
  const hasCustomRoleAssignment = (teamRoleUpdates ?? []).some(
    (update) => typeof update.role === "string" && isCustomRole(update.role),
  );
  if (hasCustomRoleAssignment) {
    assertEnterprisePlanType({
      planType,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
    });
  }
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
    .use(skipPermissionCheck)
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself from the organization",
        });
      }

      await getApp().organizations.deleteMember({
        organizationId: input.organizationId,
        userId: input.userId,
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.session.user.id && input.disabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot disable your own membership",
        });
      }

      // Re-enabling consumes a seat, so it goes through the same check as
      // inviting someone. Disabling only ever frees one, and is what an
      // over-seats organization is being asked to do, so it is never blocked.
      if (!input.disabled) {
        const enforcement = createLicenseEnforcementService(ctx.prisma);
        const result = await enforcement.checkLimit(
          input.organizationId,
          "members",
          ctx.session.user,
        );

        if (!result.allowed) {
          // The same shape every other member-limit refusal throws, so the
          // client's global handler opens the limit modal with the real
          // numbers and its "Upgrade license" link, rather than this route
          // inventing copy of its own.
          throw new TRPCError({
            code: "FORBIDDEN",
            message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
            cause: {
              limitType: "members",
              current: result.current,
              max: result.max,
            },
          });
        }
      }

      await getApp().organizations.setMemberDisabled({
        organizationId: input.organizationId,
        userId: input.userId,
        disabled: input.disabled,
      });

      return { success: true };
    }),

  getAll: protectedProcedure
    .input(
      z.object({
        isDemo: z.boolean().optional(),
      }),
    )
    .use(skipPermissionCheck)
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
      const { manageableOrgIds, updatableProjectsByOrg } =
        await resolveOrgAccessMaps({ ctx, organizations });

      redactProjectSecrets({
        organizations,
        manageableOrgIds,
        updatableProjectsByOrg,
        isDemo,
      });

      for (const organization of organizations) {
        processOrganizationForResponse({
          organization,
          userId,
          demoProjectUserId,
          demoProjectId,
          isDemo,
          userRoleBindings,
          manageableOrgIds,
        });
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      // Detect a trace-sharing disable transition before the write so the
      // kill-switch cascade mirrors the project-level behavior: disabling
      // revokes every existing trace link across the org (not just blocks new
      // ones), so re-enabling later never resurrects old links. See ADR-057.
      const wasSharingEnabled =
        input.traceSharingEnabled === false
          ? (
              await ctx.prisma.organization.findUnique({
                where: { id: input.organizationId },
                select: { traceSharingEnabled: true },
              })
            )?.traceSharingEnabled === true
          : false;

      await getApp().organizations.update({
        organizationId: input.organizationId,
        name: input.name,
        s3Endpoint: input.s3Endpoint,
        s3AccessKeyId: input.s3AccessKeyId,
        s3SecretAccessKey: input.s3SecretAccessKey,
        s3Bucket: input.s3Bucket,
        presenceEnabled: input.presenceEnabled,
        traceSharingEnabled: input.traceSharingEnabled,
        supportContact: input.supportContact,
        primaryIntent: input.primaryIntent,
      });

      if (input.traceSharingEnabled === false && wasSharingEnabled) {
        const projects = await ctx.prisma.project.findMany({
          where: { team: { organizationId: input.organizationId } },
          select: { id: true },
        });
        await Promise.all(
          projects.map((project) =>
            getApp().share.revokeAllTraceShares(project.id),
          ),
        );
      }

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
    .use(checkOrganizationPermission("organization:view"))
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

      const callerHasManage = await hasOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );
      if (!callerHasManage) {
        redactOtherMembersPii({ organization, callerId: ctx.session.user.id });
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
    .use(checkOrganizationPermission("organization:manage"))
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      await assertAdminInvitesAllowCustomRoles({
        invites: input.invites,
        organizationId: input.organizationId,
        actorUser: ctx.session.user,
      });

      const prisma = ctx.prisma;

      const organization = await prisma.organization.findFirst({
        where: {
          id: input.organizationId,
        },
        include: {
          members: true,
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const inviteService = InviteService.create(prisma);

      // Before anything is written: inviting someone who is already a member
      // used to succeed silently, adding a pending invite beside the membership
      // it duplicated. Checked ahead of the licence limit so an admin who is at
      // their seat cap is told the real reason rather than being sold an
      // upgrade for a seat they already own.
      await inviteService.assertNotAlreadyMembers({
        emails: input.invites.map((invite) => invite.email),
        organizationId: input.organizationId,
      });

      await assertAdminInviteLicenseLimits({
        inviteService,
        organizationId: input.organizationId,
        invites: input.invites,
        actorUser: ctx.session.user,
      });

      // Prepare invite data (read-only validation) outside transaction
      const preparedAdminInvites = await Promise.all(
        input.invites.map((invite) =>
          prepareAdminInvite({
            prisma,
            organizationId: input.organizationId,
            invite,
          }),
        ),
      );

      const validInvites = preparedAdminInvites.filter(
        (inv): inv is NonNullable<typeof inv> => inv !== null,
      );

      // Phase 1: DB operations in transaction (no side-effects)
      const inviteRecords = await createAdminInviteRecords({
        prisma,
        validInvites,
      });

      // Phase 2: Send emails outside transaction
      const createdRecords = inviteRecords.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );

      fireAdminInviteCreatedSideEffects({
        actorUserId: ctx.session.user.id,
        organization,
        createdRecords,
      });

      return sendAdminInviteEmails({ inviteService, createdRecords });
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.organizationInvite.delete({
        where: { id: input.inviteId, organizationId: input.organizationId },
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
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const invites = await prisma.organizationInvite.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ["PENDING", "WAITING_APPROVAL"] },
          OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
        },
        include: {
          requestedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return invites;
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
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ input, ctx }) => {
      await assertAdminInvitesAllowCustomRoles({
        invites: input.invites,
        organizationId: input.organizationId,
        actorUser: ctx.session.user,
      });

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

        assertNoDuplicatePayloadEmails(input.invites);

        const preparedInvites = await Promise.all(
          input.invites.map((invite) =>
            prepareInviteRequest({
              inviteService,
              prisma,
              organizationId: input.organizationId,
              invite,
              requestedBy: ctx.session.user.id,
            }),
          ),
        );

        return await createInviteRequestRecords({ prisma, preparedInvites });
      } catch (error) {
        throwMappedInviteRequestError(error, input.organizationId);
      }
    }),
  approveInvite: protectedProcedure
    .input(
      z.object({
        inviteId: z.string(),
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
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
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const session = ctx.session;
      const rawInvite = await prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        include: { organization: true },
      });

      const { invite, email } = requireAcceptableInvite({
        invite: rawInvite,
        session,
      });

      await applyInviteAcceptance({
        prisma,
        userId: session.user.id,
        invite,
      });

      await provisionPersonalWorkspaceBestEffort({
        prisma,
        session,
        email,
        organizationId: invite.organizationId,
      });

      fireAcceptInviteSideEffects({ session, email, invite });

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
    .use(checkTeamPermission("organization:manage"))
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
        await assertCustomRoleAssignmentAllowed({
          prisma,
          teamId: input.teamId,
          actorUser: ctx.session.user,
        });
      } else if (!inputIsCustomRole) {
        await assertBuiltInRoleAssignmentAllowed({
          prisma,
          teamId: input.teamId,
          userId: input.userId,
          role: input.role as TeamRoleValue,
          actorUser: ctx.session.user,
        });
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
    .use(checkOrganizationPermission("organization:manage"))
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
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Fetch current member to enable license checks
      const currentMember = await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: input.userId,
            organizationId: input.organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      // A caller who names a personal workspace outright is told so. Without
      // this the shared-teams-only set below would answer "that team is not in
      // the organization", which is both wrong and no help. No UI sends these
      // updates today; the procedure accepts them, so it has to answer them.
      await assertNoPersonalTeamScope({
        client: prisma,
        scopes: (input.teamRoleUpdates ?? []).map((update) => ({
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: update.teamId,
        })),
      });

      const { organizationTeamIds, currentMemberships, userPermissions } =
        await resolveCurrentTeamMembershipState({
          prisma,
          organizationId: input.organizationId,
          userId: input.userId,
        });

      const subscriptionLimits = await assertMemberRoleChangeAllowed({
        prisma,
        organizationId: input.organizationId,
        currentRole: currentMember.role,
        userPermissions,
        newRole: input.role,
        actorUser: ctx.session.user,
      });

      assertTeamRoleUpdatesAllowCustomRoles({
        teamRoleUpdates: input.teamRoleUpdates,
        planType: subscriptionLimits.type,
      });

      const { teamsLeftWithoutAdmin } =
        await getApp().organizations.updateMemberRole({
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
          teamRoleUpdates: input.teamRoleUpdates,
          currentMemberships: currentMemberships.map((m) => ({
            teamId: m.teamId,
            role: m.role,
          })),
          organizationTeamIds,
          currentUserId: ctx.session.user.id,
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
    .use(checkOrganizationPermission("auditLog:view"))
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
