/**
 * The organization surface the canonical contract does not carry: membership,
 * seats, role cascades, provisioning and the audit trail.
 */
import { generate } from "@langwatch/ksuid";
import {
  type OrganizationIntent,
  type OrganizationUserRole,
  PricingModel,
  RoleBindingScopeType,
  type TeamUserRole,
  type User,
} from "@langwatch/organization-contract";
import type { AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { PersonalWorkspaceNotManagedHereError } from "@langwatch/organization-contract";
import slugify from "slugify";
import { computeEffectiveTeamRoleUpdates } from "./compute-effective-team-role-updates.service";
import { isCustomRole } from "../rules/custom-role-naming.rules";
import type { TeamRoleValue } from "./member-role-constraints.service";
import {
  CannotDisableSelfError,
  CannotRemoveSelfError,
  MemberNotFoundError,
  MemberSeatLimitReachedError,
} from "@langwatch/organization-contract";

import {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  type OrganizationPlanUser,
} from "../ports/organization-membership.port";
import type {
  AuditLogFilters,
  CreateAndAssignResult,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  MemberTeamBinding,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationProvisioningSummary,
  OrganizationMembershipRepository,
  OrganizationWithMembersAndTheirTeams,
  UpdateMemberRoleResult,
} from "../repositories/organization-membership.repository";

/** The KSUID resources an organization and its first team are born under. */
const ORGANIZATION_KSUID_RESOURCE = "organization";
const TEAM_KSUID_RESOURCE = "team";

/**
 * Pure function that returns a team enriched with a synthesized member entry
 * for the given user if they have a RoleBinding for this team or one of its
 * projects but no TeamUser row yet.
 */
type TeamMembershipLike = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  assignedRole?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

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

/**
 * The membership, provisioning and audit operations, over one repository and
 * four ports.
 */
export class OrganizationMembershipService {
  static enrichTeamWithRoleBindings<
    T extends {
      members: TeamMembershipLike[];
      id: string;
      projects: { id: string }[];
    },
  >(
    team: T,
    userId: string,
    userRoleBindings: AuthzBindingForSynthesis[],
    organizationId: string,
  ): T {
    const teamProjectIds = new Set(team.projects.map((p) => p.id));
    // TEAM scope takes precedence over PROJECT scope so the synthesized role is
    // deterministic when a user has both kinds of binding for the same team.
    const teamBinding = userRoleBindings.find(
      (b) =>
        b.organizationId === organizationId &&
        b.scopeType === RoleBindingScopeType.TEAM &&
        b.scopeId === team.id,
    );
    const projectBinding = teamBinding
      ? undefined
      : userRoleBindings.find(
          (b) =>
            b.organizationId === organizationId &&
            b.scopeType === RoleBindingScopeType.PROJECT &&
            teamProjectIds.has(b.scopeId),
        );
    const binding = teamBinding ?? projectBinding;
    if (!binding) {
      return team;
    }

    const bindingMember = {
      userId,
      teamId: team.id,
      role: binding.role,
      assignedRoleId: binding.customRoleId ?? null,
      assignedRole: binding.customRole ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const existingIndex = team.members.findIndex((m) => m.userId === userId);
    const newMembers =
      existingIndex >= 0
        ? team.members.map((m, i) => (i === existingIndex ? bindingMember : m))
        : [...team.members, bindingMember];

    return { ...team, members: newMembers };
  }

  static create(dependencies: {
    repository: OrganizationMembershipRepository;
    prompts: OrganizationPromptSeedPort;
    seats: OrganizationSeatLicensePort;
    sessions: OrganizationSessionRevocationPort;
    grantCache: OrganizationGrantCachePort;
  }): OrganizationMembershipService {
    return new OrganizationMembershipService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      repository: OrganizationMembershipRepository;
      prompts: OrganizationPromptSeedPort;
      seats: OrganizationSeatLicensePort;
      sessions: OrganizationSessionRevocationPort;
      grantCache: OrganizationGrantCachePort;
    },
  ) {}

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  async tryGetUserOrgRole(params: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.tryGetUserOrgRole(params);
  }

  async tryGetUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.tryGetUserOrgRoleByTeamId(params);
  }

  /**
   * The org's declared primary intent (ADR-038); null = intent unset
   * (legacy org). Consumed by the home resolver to pin the "/" landing.
   */
  async tryGetPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.repo.tryFindPrimaryIntentById(organizationId);
  }

  /**
   * Creates an organization with a default team and assigns the given user as
   * admin.
   * they are ledger facts (ADR-092 delivery-plan PR 2) — so they follow it,
   */
  async createAndAssign(params: {
    userId: string;
    orgName?: string;
    phoneNumber?: string;
    signUpData?: Record<string, unknown>;
    primaryIntent?: OrganizationIntent | null;
    userDisplayName?: string | null;
  }): Promise<CreateAndAssignResult> {
    const orgName = params.orgName ?? params.userDisplayName ?? "My Organization";
    const orgId = generate(ORGANIZATION_KSUID_RESOURCE).toString();
    const orgSlug =
      slugify(orgName, { lower: true, strict: true }) + "-" + orgId.substring(orgId.length - 6);

    const teamId = generate(TEAM_KSUID_RESOURCE).toString();
    const teamSlug =
      slugify(orgName, { lower: true, strict: true }) + "-" + teamId.substring(teamId.length - 6);

    const result = await this.repo.createAndAssign({
      userId: params.userId,
      orgId,
      orgName,
      orgSlug,
      teamId,
      teamSlug,
      phoneNumber: params.phoneNumber,
      signUpData: params.signUpData,
      primaryIntent: params.primaryIntent,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    await this.dependencies.prompts.seedTagsForOrganization({
      organizationId: result.organization.id,
    });

    return result;
  }

  /**
   * Creates an organization with a default team and NO user attached: the
   * self-hosted instance provisioning path ({@link createAndAssign} requires a
   * member to assign, and this path runs before any user exists).
   */
  async createForProvisioning(params: {
    name: string;
    slug?: string;
  }): Promise<CreateAndAssignResult> {
    const orgId = generate(ORGANIZATION_KSUID_RESOURCE).toString();
    const orgSlug =
      params.slug ??
      slugify(params.name, { lower: true, strict: true }) + "-" + orgId.substring(orgId.length - 6);

    const teamId = generate(TEAM_KSUID_RESOURCE).toString();
    const teamSlug =
      slugify(params.name, { lower: true, strict: true }) +
      "-" +
      teamId.substring(teamId.length - 6);

    const result = await this.repo.createForProvisioning({
      orgId,
      orgName: params.name,
      orgSlug,
      teamId,
      teamSlug,
      pricingModel: PricingModel.SEAT_EVENT,
    });

    try {
      await this.dependencies.prompts.seedTagsForOrganization({
        organizationId: result.organization.id,
      });
    } catch (error) {
      // The caller has to see what actually went wrong, so a compensation
      // that fails too is reported rather than raised over the top of it.
      try {
        await this.repo.deleteProvisionedOrganization(result.organization.id);
      } catch (compensationError) {
        this.dependencies.prompts.reportCompensationFailure(
          compensationError instanceof Error
            ? compensationError
            : new Error(String(compensationError)),
        );
      }

      throw error;
    }

    return result;
  }

  /** Every organization on the instance, for the instance-admin surface. */
  async listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    return this.repo.findAllProvisioningSummaries();
  }

  /**
   * Compensation for a provisioning run that created the organization but could not finish: without its bootstrap key the
   * organization is unreachable, and its slug squats every retry as a 409. Removing what the run created lets the caller simply
   * retry. Provisioning is the only caller; nothing else may delete an organization through this surface.
   */
  async deleteProvisionedOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    await this.repo.deleteProvisionedOrganization(organizationId);
  }

  /** One organization's provisioning summary, or null when the id is unknown. */
  async tryGetProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    return this.repo.tryFindProvisioningSummaryById(organizationId);
  }

  /**
   * Returns fully loaded organizations for a user. Returns raw (encrypted) records;
   * the router applies decryption before sending to the client.
   */
  async getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    return this.repo.getAllForUser(params);
  }

  /**
   * Returns an organization with its members and their team memberships.
   * Returns null when the user is not a member of the organization.
   */
  async tryGetOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.repo.tryGetOrganizationWithMembers(params);
  }

  /**
   * Returns a single organization member by userId, verifying the current user's access.
   * Returns null when the current user is not a member (not found) or the target member
   * does not exist.
   */
  async tryGetMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    return this.repo.tryGetMemberById(params);
  }

  /**
   * Returns all active (non-deactivated) users in an organization.
   */
  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.repo.getAllMembers(organizationId);
  }

  /**
   * Paginated membership list for the management surface. No caller
   * pre-check: authentication happens at the boundary through the
   * organization credential, not a session user.
   */
  async listMembers(params: {
    organizationId: string;
    includeDisabled?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    return this.repo.findAllMembers({
      organizationId: params.organizationId,
      includeDisabled: params.includeDisabled ?? false,
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
    });
  }

  /**
   * One member with their role, disabled status and team bindings (personal
   * workspaces excluded). Throws {@link MemberNotFoundError} when the user is
   * not a member of this organization.
   */
  async getMember(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary & { teams: MemberTeamBinding[] }> {
    const membership = await this.repo.tryFindMembership(params);
    if (!membership) {
      throw new MemberNotFoundError(params.userId);
    }

    const teams = await this.repo.findMemberTeamBindings(params);

    return { ...membership, teams };
  }

  /**
   * Removes a user from an organization and all its teams.
   */
  async deleteMember(params: {
    organizationId: string;
    userId: string;
    actingUserId?: string | null;
  }): Promise<void> {
    if (params.actingUserId != null && params.actingUserId === params.userId) {
      throw new CannotRemoveSelfError();
    }

    const membership = await this.repo.tryFindMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });
    if (!membership) {
      throw new MemberNotFoundError(params.userId);
    }

    return this.repo.deleteMember({
      organizationId: params.organizationId,
      userId: params.userId,
      actingUserId: params.actingUserId ?? null,
    });
  }

  /**
   * Disables or re-enables a membership, which revokes or restores access to
   * this organization and returns or takes back a licensed seat. Role,
   * department and history are untouched, so this is reversible.
   */
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
   * The full member-role-change orchestration: personal-workspace assertion, shared-team scoping, seat
   * classification (a Lite Member gaining non-view permissions re-checks the full-member seats) and the
   * Enterprise gate for custom-role assignments, then the cascading role update itself.
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

    const effectiveTeamRoleUpdates = computeEffectiveTeamRoleUpdates({
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
  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return this.repo.getAuditLogs(filters);
  }
}
