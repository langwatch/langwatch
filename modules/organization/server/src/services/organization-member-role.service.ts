/**
 * Changing what a member may do: enabling and disabling a seat, and the cascading role update
 * across the organization and its teams.
 */
import {
  RoleBindingScopeType,
  type OrganizationUserRole,
  type TeamUserRole,
} from "@langwatch/organization-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  CannotDisableSelfError,
  MemberNotFoundError,
  MemberSeatLimitReachedError,
  PersonalWorkspaceNotManagedHereError,
} from "@langwatch/organization-contract";
import { EffectiveTeamRoleUpdatesService } from "./compute-effective-team-role-updates.service.ts";
import { isCustomRole } from "../rules/custom-role-naming.rules.ts";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules.ts";
import {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
  type OrganizationPlanUser,
} from "../app/organization.members.ts";
import type {
  OrganizationMembershipRepository,
  UpdateMemberRoleResult,
} from "../repositories/organization-membership.repository.ts";

/**
 * The union of permissions granted by the custom roles behind these team bindings, or
 * undefined when none apply. Feeds seat classification, which treats a member whose custom
 * roles grant only view permissions as a Lite Member.
 */
async function collectCustomRolePermissions({
  repository,
  organizationId,
  currentTeamBindings,
}: {
  repository: OrganizationMembershipRepository;
  organizationId: string;
  currentTeamBindings: Array<{ customRoleId: string | null }>;
}): Promise<string[] | undefined> {
  const customRoleIds = currentTeamBindings
    .map((binding) => binding.customRoleId)
    .filter((id): id is string => !!id);
  if (customRoleIds.length === 0) {
    return undefined;
  }

  const permissionsPerRole = await repository.findCustomRolePermissions({
    organizationId,
    customRoleIds,
  });
  const allPermissions: string[] = [];
  for (const permissions of permissionsPerRole) {
    // `permissions` is a Json column, so the row decides the shape, not the
    // type: read it defensively the way every other permission reader does.
    if (Array.isArray(permissions)) {
      allPermissions.push(
        ...permissions.filter((permission): permission is string => typeof permission === "string"),
      );
    }
  }

  return allPermissions.length > 0 ? allPermissions : undefined;
}

/**
 * A team-role update the caller could not have meant: it names a different
 * member, or a team outside the organization whose seats are being changed.
 */
class TeamRoleUpdateRejectedError extends HandledError {
  declare readonly code: "validation_error";

  constructor(message: string, meta: Readonly<Record<string, unknown>>) {
    super("validation_error", message, { httpStatus: 400, fault: "customer", meta });
    this.name = "TeamRoleUpdateRejectedError";
  }
}

type OrganizationMemberRoleDependencies = {
  repository: OrganizationMembershipRepository;
  prompts: OrganizationPromptSeed;
  seats: OrganizationSeatLicense;
  sessions: OrganizationSessionRevocation;
  grantCache: OrganizationGrantCache;
};

export class OrganizationMemberRoleService {
  static create(dependencies: OrganizationMemberRoleDependencies): OrganizationMemberRoleService {
    return new OrganizationMemberRoleService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationMemberRoleDependencies) {}

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  async setMemberDisabled(params: {
    organizationId: string;
    userId: string;
    disabled: boolean;
    /** The user the credential acts as; null (a service key) skips the self-guard. */
    actingUser?: OrganizationPlanUser | null;
  }): Promise<void> {
    const { organizationId, userId, disabled, actingUser } = params;

    if (disabled && actingUser?.id != null && actingUser.id === userId) {
      throw new CannotDisableSelfError();
    }

    const membership = await this.repo.tryFindMembership({
      organizationId,
      userId,
    });
    if (!membership) {
      throw new MemberNotFoundError(userId);
    }

    if (!disabled) {
      const result = await this.dependencies.seats.checkLimit({
        organizationId,
        resource: "members",
        user: actingUser ?? undefined,
      });
      if (!result.allowed) {
        // The counts ride along only when the decision carried them: a port
        // that refused without them must not report a limit of `undefined`
        // as if it were a number the customer could read.
        throw new MemberSeatLimitReachedError(
          result.limitType !== undefined && result.current !== undefined && result.max !== undefined
            ? {
                meta: {
                  limitType: result.limitType,
                  current: result.current,
                  max: result.max,
                },
              }
            : {},
        );
      }
    }

    await this.repo.setMemberDisabled({ organizationId, userId, disabled });

    if (disabled) {
      // Revoking the seat has to revoke the live session too, or the person
      // keeps working until their token happens to expire. Through the
      // canonical Auth service: it clears the Better Auth session cache as
      // well as the rows, which is the half a plain delete misses.
      await this.dependencies.sessions.revokeAllBrowserSessions({ userId });
    }

    // Disabling is a plain column write, not a grant write, so nothing else
    // retires the authorization snapshots cached for this organization. An
    // admin who has just revoked someone's access must not have to wait for a
    // cache to age out before it is true, and re-enabling must not leave the
    // person locked out for the same window.
    await this.dependencies.grantCache.invalidateOrganization({ organizationId });
  }

  /**
   * The full member-role-change orchestration: personal-workspace assertion, shared-team scoping,
   * seat classification, the Enterprise gate for custom roles, then the cascading role update.
   */
  async changeMemberRole(params: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: Array<{
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }>;
    /** Null when the actor is a service credential; self checks never match. */
    currentUserId: string | null;
    planUser?: OrganizationPlanUser;
  }): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, teamRoleUpdates, currentUserId } = params;

    const currentMember = await this.repo.tryFindMembership({
      organizationId,
      userId,
    });
    if (!currentMember) {
      throw new MemberNotFoundError(userId);
    }

    // A caller who names a personal workspace outright is told so. Without
    // this the shared-teams-only set below would answer "that team is not in
    // the organization", which is both wrong and no help.
    const personalTeam = await this.repo.tryFindPersonalTeamInScopes({
      scopes: (teamRoleUpdates ?? []).map((update) => ({
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: update.teamId,
      })),
    });
    if (personalTeam) {
      throw new PersonalWorkspaceNotManagedHereError(personalTeam.name);
    }

    // Only the teams the organization shares. A seat decision is about the
    // person, so it applies to the teams they work in with other people and
    // leaves the workspace that is only theirs alone. Including it would ask
    // the organization to demote a team's last admin, which is refused, and
    // the whole role change would go down with the refusal.
    const organizationTeamIds = await this.repo.findSharedTeamIds({ organizationId });

    const currentTeamBindings = await this.repo.findTeamRoleBindings({
      organizationId,
      userId,
      teamIds: organizationTeamIds,
    });

    const currentMemberships = currentTeamBindings.map((binding) => ({
      teamId: binding.scopeId,
      role: binding.role,
    }));

    const userPermissions = await collectCustomRolePermissions({
      repository: this.repo,
      organizationId,
      currentTeamBindings,
    });

    await this.dependencies.seats.assertRoleChangeAllowed({
      organizationId,
      currentRole: currentMember.role,
      userPermissions,
      role,
      teamRoleUpdates,
      user: params.planUser,
    });

    return await this.updateMemberRole({
      organizationId,
      userId,
      role,
      teamRoleUpdates,
      currentMemberships,
      organizationTeamIds,
      currentUserId,
    });
  }

  /**
   * Updates a member's organization role and cascades effective team role
   * changes. Computes effective team role updates from the requested updates and
   * current memberships.
   */
  async updateMemberRole(params: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: Array<{
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }>;
    currentMemberships: Array<{ teamId: string; role: TeamUserRole }>;
    organizationTeamIds: string[];
    currentUserId: string | null;
  }): Promise<UpdateMemberRoleResult> {
    const {
      organizationId,
      userId,
      role,
      teamRoleUpdates,
      currentMemberships,
      organizationTeamIds,
      currentUserId,
    } = params;

    const organizationTeamIdSet = new Set(organizationTeamIds);

    const requestedTeamRoleUpdates = (teamRoleUpdates ?? []).reduce<
      Array<{ teamId: string; role: TeamRoleValue; customRoleId?: string }>
    >((acc, update) => {
      if (update.userId !== userId) {
        throw new TeamRoleUpdateRejectedError("Team role update user must match target member", {
          userId,
        });
      }

      if (!organizationTeamIdSet.has(update.teamId)) {
        throw new TeamRoleUpdateRejectedError("Team role update must belong to the organization", {
          userId,
        });
      }

      acc.push({
        teamId: update.teamId,
        role: update.role as TeamRoleValue,
        customRoleId: update.customRoleId,
      });

      return acc;
    }, []);

    const effectiveTeamRoleUpdates =
      EffectiveTeamRoleUpdatesService.create().computeEffectiveTeamRoleUpdates({
        requestedTeamRoleUpdates,
        currentMemberships,
        newOrganizationRole: role,
      });

    return await this.repo.updateMemberRole({
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates,
      currentUserId,
    });
  }

  /**
   * Updates a team member's role. The repository decides the change under one transaction —
   * the last-admin guard included — and emits the grant it resolves to once that has
   * committed, since grants are ledger facts and cannot ride a database transaction.
   */
  async updateTeamMemberRole(params: {
    teamId: string;
    userId: string;
    role: string;
    customRoleId?: string;
    currentUserId: string;
  }): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId } = params;

    if (isCustomRole(role)) {
      if (!customRoleId) {
        throw new TeamRoleUpdateRejectedError("customRoleId is required when using a custom role", {
          userId,
        });
      }

      await this.repo.updateTeamMemberRole({
        teamId,
        userId,
        role: role as TeamUserRole,
        customRoleId,
        currentUserId,
      });
    } else {
      await this.repo.updateTeamMemberRole({
        teamId,
        userId,
        role: role as TeamUserRole,
        customRoleId: undefined,
        currentUserId,
      });
    }
  }

  /**
   * Returns paginated, enriched audit log entries for an organization.
   */
}
