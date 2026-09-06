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
import slugify from "slugify";
import { OrganizationMemberRoleService } from "./organization-member-role.service.ts";
import { CannotRemoveSelfError, MemberNotFoundError } from "@langwatch/organization-contract";

import {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  type OrganizationPlanUser,
} from "../ports/organization-membership.port.ts";
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
} from "../repositories/organization-membership.repository.ts";

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
  ) {
    this.roles = OrganizationMemberRoleService.create(dependencies);
  }

  private readonly roles: OrganizationMemberRoleService;

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
   * Compensation for a provisioning run that created the organization but couldn't finish, whose
   * slug would otherwise squat every retry as a 409. Provisioning is the only caller.
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
    await this.roles.setMemberDisabled(params);
  }

  async changeMemberRole(
    params: Parameters<OrganizationMemberRoleService["changeMemberRole"]>[0],
  ): ReturnType<OrganizationMemberRoleService["changeMemberRole"]> {
    return this.roles.changeMemberRole(params);
  }

  async updateMemberRole(
    params: Parameters<OrganizationMemberRoleService["updateMemberRole"]>[0],
  ): ReturnType<OrganizationMemberRoleService["updateMemberRole"]> {
    return this.roles.updateMemberRole(params);
  }

  async updateTeamMemberRole(
    params: Parameters<OrganizationMemberRoleService["updateTeamMemberRole"]>[0],
  ): ReturnType<OrganizationMemberRoleService["updateTeamMemberRole"]> {
    return this.roles.updateTeamMemberRole(params);
  }

  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return this.repo.getAuditLogs(filters);
  }
}
