/**
 * Changing what a member may do: enabling and disabling a seat, and the cascading role update
 * across the organization and its teams.
 */
import { GrantScopeTier, type AuthzGrantCaller } from "@langwatch/authz-contract";
import { getRoleChangeType, isFullMember } from "@langwatch/entitlement-contract";
import {
  TeamRoleUpdateRejectedError,
  OrganizationUserRole,
  type TeamUserRole,
  CannotDisableSelfError,
  MemberSeatLimitReachedError,
  PersonalWorkspaceNotManagedHereError,
} from "@langwatch/organization-contract";

import type {
  OrganizationMembershipRepository,
  UpdateMemberRoleResult,
} from "../repositories/organization-membership.repository.ts";
import type { SeatTransition } from "../repositories/seat-hold.repository.ts";
import { isCustomRole } from "../rules/custom-role-naming.rules.ts";
import {
  customRoleIdsOf,
  customRolePermissionsOf,
} from "../rules/custom-role-permissions.rules.ts";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "../rules/member-role-constraints.rules.ts";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules.ts";
import {
  EffectiveTeamRoleUpdatesService,
  type EffectiveTeamRoleUpdate,
} from "./compute-effective-team-role-updates.service.ts";
import type {
  OrganizationGrantCeilingService,
  OrganizationIntendedGrant,
} from "./organization-grant-ceiling.service.ts";
import type {
  OrganizationSeatLicense,
  OrganizationPlanUser,
} from "./organization-seat-license.service.ts";
import type { SeatHoldService } from "./seat-hold.service.ts";

/**
 * Records a seat taken away or given back. User ends the person's browser sessions from the
 * first (§9, R7); a disable this cannot record is refused, not half-performed.
 */
export interface OrganizationSeatRevocationNotice {
  memberDisabled(input: {
    organizationId: string;
    userId: string;
    disabledByUserId: string | null;
  }): Promise<void>;
  memberEnabled(input: {
    organizationId: string;
    userId: string;
    enabledByUserId: string | null;
  }): Promise<void>;
}

/**
 * The authorization snapshots cached for one organization. Disabling a membership is a plain
 * column write, not a grant write, so nothing else retires those snapshots.
 */
export interface OrganizationGrantCache {
  invalidateOrganization(input: { organizationId: string }): Promise<void>;
}

/**
 * The union of permissions granted by the custom roles behind these team bindings, empty
 * when none apply. Feeds seat classification, which treats a member whose custom
 * roles grant only view permissions as a Lite Member.
 */
async function findCustomRolePermissionGrants({
  repository,
  organizationId,
  currentTeamBindings,
}: {
  repository: OrganizationMembershipRepository;
  organizationId: string;
  currentTeamBindings: { customRoleId: string | null }[];
}): Promise<string[]> {
  const customRoleIds = customRoleIdsOf({ bindings: currentTeamBindings });
  if (customRoleIds.length === 0) {
    return [];
  }
  const permissionsPerRole = await repository.findCustomRolePermissions({
    organizationId,
    customRoleIds,
  });
  return customRolePermissionsOf({ permissionsPerRole });
}

type OrganizationMemberRoleDependencies = {
  repository: OrganizationMembershipRepository;
  seats: OrganizationSeatLicense;
  seatNotices: OrganizationSeatRevocationNotice;
  grantCache: OrganizationGrantCache;
  ceiling: Pick<OrganizationGrantCeilingService, "assertWithinCaller">;
  /** The 30-day seat hold a disable, enable or role change writes (seat-rotation.feature). */
  seatHolds: SeatHoldService;
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

    await this.repo.getMembership({ organizationId, userId });

    const seat = disabled
      ? await this.dependencies.seatHolds.releaseOf({ organizationId, userId, reason: "DISABLED" })
      : await this.seatOnEnable({ organizationId, userId, actingUser: actingUser ?? undefined });

    await this.repo.setMemberDisabled({ organizationId, userId, disabled, seat });

    if (disabled) {
      // The seat is gone and the authz snapshot retired below, so the next request is refused
      // now; user ends the live browser sessions from this fact (§9, R7).
      await this.dependencies.seatNotices.memberDisabled({
        organizationId,
        userId,
        disabledByUserId: actingUser?.id ?? null,
      });
    } else {
      // M8487-MEMBER-ENABLED: governance puts the person's personal project back in aggregates.
      await this.dependencies.seatNotices.memberEnabled({
        organizationId,
        userId,
        enabledByUserId: actingUser?.id ?? null,
      });
    }

    // Disabling is a plain column write, not a grant write, so nothing else
    // retires the authorization snapshots cached for this organization. An
    // admin who has just revoked someone's access must not have to wait for a
    // cache to age out before it is true, and re-enabling must not leave the
    // person locked out for the same window.
    await this.dependencies.grantCache.invalidateOrganization({ organizationId });
  }

  /**
   * Gives a full seat to a person admission left waiting (seat-rotation.feature): their membership
   * becomes MEMBER and is enabled. Answers false, changing nothing, when they no longer wait or no
   * full seat fits.
   */
  async admitWaitingMember({
    organizationId,
    userId,
    actingUserId,
    caller,
  }: {
    organizationId: string;
    userId: string;
    actingUserId: string | null;
    caller: AuthzGrantCaller;
  }): Promise<boolean> {
    const { seatHolds, seats, seatNotices, grantCache } = this.dependencies;
    if (!(await seatHolds.isWaiting({ organizationId, userId }))) return false;
    if (!(await seatHolds.hasLiveHold({ organizationId, userId }))) {
      const fit = await seats.checkLimit({ organizationId, resource: "members" });
      if (!fit.allowed) return false;
    }
    // The role first, while the membership is still disabled: access comes with the enable.
    await this.repo.updateMemberRole({
      organizationId,
      userId,
      role: OrganizationUserRole.MEMBER,
      effectiveTeamRoleUpdates: [],
      currentUserId: actingUserId,
      caller,
      seat: await seatHolds.takeOf({ organizationId, userId }),
    });
    await this.repo.setMemberDisabled({ organizationId, userId, disabled: false });
    await seatNotices.memberEnabled({ organizationId, userId, enabledByUserId: actingUserId });
    await grantCache.invalidateOrganization({ organizationId });
    return true;
  }

  /**
   * The seat an enable takes: a disabled full member takes their hold back, else a seat the plan
   * must still have free. A person who already holds their seat, or has a hold, is not re-checked.
   */
  private async seatOnEnable({
    organizationId,
    userId,
    actingUser,
  }: {
    organizationId: string;
    userId: string;
    actingUser: OrganizationPlanUser | undefined;
  }): Promise<SeatTransition> {
    const { seatHolds, seats } = this.dependencies;
    if (!(await seatHolds.hasLiveHold({ organizationId, userId }))) {
      const result = await seats.checkLimit({
        organizationId,
        resource: "members",
        user: actingUser,
      });
      if (!result.allowed) {
        throw new MemberSeatLimitReachedError({
          meta: { limitType: result.limitType, current: result.current, max: result.max },
        });
      }
    }
    const [standing] = await this.repo.findSeatStandings({ organizationId, userId });
    if (!standing || standing.disabledAt === null) return { kind: "unchanged" };
    if (!(await seatHolds.classifiesFull({ organizationId, userId, standing }))) {
      return { kind: "unchanged" };
    }
    return seatHolds.takeOf({ organizationId, userId });
  }

  /**
   * Main's seat guard on a Lite Member's team-role change (organization.ts:699-730): moving
   * them off a custom role that granted more than viewing costs a Lite Member seat.
   */
  async assertTeamRoleChangeWithinSeatLimits(params: {
    organizationId: string;
    teamId: string;
    userId: string;
  }): Promise<void> {
    const { organizationId, teamId, userId } = params;
    const currentTeamBindings = await this.repo.findTeamGrants({
      organizationId,
      userId,
      teamIds: [teamId],
    });
    const grantedPermissions = await findCustomRolePermissionGrants({
      repository: this.repo,
      organizationId,
      currentTeamBindings,
    });

    await this.dependencies.seats.assertRoleChangeAllowed({
      organizationId,
      currentRole: "EXTERNAL",
      userPermissions: grantedPermissions.length > 0 ? grantedPermissions : undefined,
      role: "EXTERNAL",
    });
  }

  /**
   * The full member-role-change orchestration: personal-workspace assertion, shared-team scoping,
   * seat classification, the Enterprise gate for custom roles, then the cascading role update.
   */
  async changeMemberRole(params: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: {
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }[];
    /** Null when the actor is a service credential; self checks never match. */
    currentUserId: string | null;
    /** Whose holdings bound the grants the change writes. */
    caller: AuthzGrantCaller;
    planUser?: OrganizationPlanUser;
  }): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, teamRoleUpdates, currentUserId, caller } = params;

    const currentMember = await this.repo.getMembership({ organizationId, userId });
    // A caller who names a personal workspace outright is told so. Without
    // this the shared-teams-only set below would answer "that team is not in
    // the organization", which is both wrong and no help.
    const [personalTeam] = await this.repo.findPersonalTeamsInScopes({
      scopes: (teamRoleUpdates ?? []).map((update) => ({
        scopeType: GrantScopeTier.TEAM,
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

    const currentTeamBindings = await this.repo.findTeamGrants({
      organizationId,
      userId,
      teamIds: organizationTeamIds,
    });

    const currentMemberships = currentTeamBindings.map((binding) => ({
      teamId: binding.scopeId,
      role: binding.role,
    }));

    const grantedPermissions = await findCustomRolePermissionGrants({
      repository: this.repo,
      organizationId,
      currentTeamBindings,
    });
    const userPermissions = grantedPermissions.length > 0 ? grantedPermissions : undefined;
    const effectiveTeamRoleUpdates = this.effectiveTeamRoleUpdatesOf({
      userId,
      role,
      teamRoleUpdates,
      currentMemberships,
      organizationTeamIds,
    });

    // Asked before anything is written, seat corrections included: the seat commits first.
    await this.dependencies.ceiling.assertWithinCaller({
      organizationId,
      caller,
      grants: intendedRoleChangeGrants({ organizationId, role, effectiveTeamRoleUpdates }),
    });

    const seat = await this.seatOnRoleChange({
      organizationId,
      userId,
      active: currentMember.disabledAt === null,
      oldRole: currentMember.role,
      oldPermissions: userPermissions,
      role,
    });
    // A person taking back their own held seat is not asked for a second one.
    if (
      seat?.kind !== "taken" ||
      !(await this.dependencies.seatHolds.hasLiveHold({ organizationId, userId }))
    ) {
      await this.dependencies.seats.assertRoleChangeAllowed({
        organizationId,
        currentRole: currentMember.role,
        userPermissions,
        role,
        user: params.planUser,
      });
    }

    return this.repo.updateMemberRole({
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates,
      currentUserId,
      caller,
      seat,
    });
  }

  /** A role change onto a full seat takes one; one off a full seat leaves its hold. */
  private async seatOnRoleChange({
    organizationId,
    userId,
    active,
    oldRole,
    oldPermissions,
    role,
  }: {
    organizationId: string;
    userId: string;
    active: boolean;
    oldRole: OrganizationUserRole;
    oldPermissions: string[] | undefined;
    role: OrganizationUserRole;
  }): Promise<SeatTransition> {
    // A disabled membership holds no seat, so changing its role moves none.
    if (!active) return { kind: "unchanged" };
    const change = getRoleChangeType({
      oldRole,
      oldPermissions,
      newRole: role,
      newPermissions: undefined,
    });
    const { seatHolds } = this.dependencies;
    if (change === "lite-to-full") return seatHolds.takeOf({ organizationId, userId });
    const leavesFullSeat =
      change === "full-to-lite" ||
      (change === "to-developer" && isFullMember(oldRole, oldPermissions));
    if (!leavesFullSeat) return { kind: "unchanged" };
    return seatHolds.releaseOf({ organizationId, userId, reason: "DEMOTED" });
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
    teamRoleUpdates?: {
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }[];
    currentMemberships: { teamId: string; role: TeamUserRole }[];
    organizationTeamIds: string[];
    currentUserId: string | null;
    caller: AuthzGrantCaller;
  }): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, currentUserId, caller } = params;

    return this.repo.updateMemberRole({
      organizationId,
      userId,
      role,
      effectiveTeamRoleUpdates: this.effectiveTeamRoleUpdatesOf(params),
      currentUserId,
      caller,
    });
  }

  /** The team-role changes a role change makes: the requested ones, plus any seat corrections. */
  private effectiveTeamRoleUpdatesOf({
    userId,
    role,
    teamRoleUpdates,
    currentMemberships,
    organizationTeamIds,
  }: {
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: { teamId: string; userId: string; role: string; customRoleId?: string }[];
    currentMemberships: { teamId: string; role: TeamUserRole }[];
    organizationTeamIds: string[];
  }): EffectiveTeamRoleUpdate[] {
    const organizationTeamIdSet = new Set(organizationTeamIds);

    const requestedTeamRoleUpdates = (teamRoleUpdates ?? []).reduce<
      { teamId: string; role: TeamRoleValue; customRoleId?: string }[]
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

    return EffectiveTeamRoleUpdatesService.create().computeEffectiveTeamRoleUpdates({
      requestedTeamRoleUpdates,
      currentMemberships,
      newOrganizationRole: role,
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
    /** The team's organization, resolved by the caller of this door. */
    organizationId: string;
    caller: AuthzGrantCaller;
  }): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId, organizationId, caller } = params;
    await this.dependencies.ceiling.assertWithinCaller({
      organizationId,
      caller,
      grants: [intendedTeamGrant({ teamId, role, customRoleId })],
    });

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
        caller,
      });
    } else {
      await this.repo.updateTeamMemberRole({
        teamId,
        userId,
        role: role as TeamUserRole,
        customRoleId: undefined,
        currentUserId,
        caller,
      });
    }
  }

  /**
   * Returns paginated, enriched audit log entries for an organization.
   */
}

/** The grants a member-role change writes: the organization role (none if EXTERNAL), then teams. */
function intendedRoleChangeGrants({
  organizationId,
  role,
  effectiveTeamRoleUpdates,
}: {
  organizationId: string;
  role: OrganizationUserRole;
  effectiveTeamRoleUpdates: EffectiveTeamRoleUpdate[];
}): OrganizationIntendedGrant[] {
  return [
    ...(role === OrganizationUserRole.EXTERNAL
      ? []
      : [
          {
            role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
            scopeType: GrantScopeTier.ORGANIZATION,
            scopeId: organizationId,
          },
        ]),
    ...effectiveTeamRoleUpdates.map((update) =>
      intendedTeamGrant({
        teamId: update.teamId,
        role: update.role,
        customRoleId: update.customRoleId,
      }),
    ),
  ];
}

/** The team grant a requested role resolves to: a built-in role, or `custom:<id>` with its id. */
function intendedTeamGrant({
  teamId,
  role,
  customRoleId,
}: {
  teamId: string;
  role: string;
  customRoleId?: string;
}): OrganizationIntendedGrant {
  if (role === "ADMIN" || role === "MEMBER" || role === "VIEWER") {
    return { role, scopeType: GrantScopeTier.TEAM, scopeId: teamId };
  }
  return {
    role: "CUSTOM",
    customRoleId: customRoleId ?? null,
    scopeType: GrantScopeTier.TEAM,
    scopeId: teamId,
  };
}
