import {
  newAuthzBindingId,
  type AuthzApi,
  type AuthzBindingForSynthesis,
  type GrantsLedgerActor,
} from "@langwatch/authz-contract";
/**
 * The organization surface the canonical contract does not carry: membership,
 * seats, role cascades, provisioning and the audit trail.
 */
import { HandledError } from "@langwatch/handled-error";
import {
  SsoTestArrivalCannotCreateOrganizationError,
  type SsoTestArrivalStanding,
} from "@langwatch/identity-contract";
import { generate } from "@langwatch/ksuid";
import {
  type OrganizationAdministrator,
  type OrganizationIntent,
  type OrganizationUser,
  OrganizationUserRole,
  PricingModel,
  RoleBindingScopeType,
  type TeamUserRole,
  type User,
  CannotRemoveLastAdminError,
  CannotRemoveSelfError,
} from "@langwatch/organization-contract";
import { nowInstant, toDate } from "@langwatch/time";
import slugify from "slugify";

import {
  type OrganizationGrantCache,
  type OrganizationPromptSeed,
  type OrganizationSeatLicense,
  type OrganizationSessionRevocation,
  type OrganizationPlanUser,
} from "../app/organization.members.ts";
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
import { OrganizationMemberRoleService } from "./organization-member-role.service.ts";

/**
 * Whether this person is mid-way through proving a single sign-on connection
 * rather than starting out. Identity's answer, since it owns the connection
 * and the account the test sign-in left behind (ADR-129).
 */
export interface OrganizationTestArrivals {
  standingFor(args: { userId: string }): Promise<SsoTestArrivalStanding>;
}

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
  createdAt: OrganizationUser["createdAt"];
  updatedAt: OrganizationUser["updatedAt"];
};

/**
 * The membership, provisioning and audit operations, over one repository and
 * four ports.
 */
/** The grant half of an admission, answered by the authorization peer. */
export type OrganizationAdmissions = Pick<AuthzApi, "attachBindings" | "completeAdmission">;

export class OrganizationMembershipService {
  static enrichTeamWithRoleBindings<
    T extends {
      members: TeamMembershipLike[];
      id: string;
      projects: { id: string }[];
    },
  >({
    team,
    userId,
    userRoleBindings,
    organizationId,
  }: {
    team: T;
    userId: string;
    userRoleBindings: AuthzBindingForSynthesis[];
    organizationId: string;
  }): T {
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
      createdAt: toDate(nowInstant()),
      updatedAt: toDate(nowInstant()),
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
    prompts: OrganizationPromptSeed;
    seats: OrganizationSeatLicense;
    sessions: OrganizationSessionRevocation;
    grantCache: OrganizationGrantCache;
    testArrivals: OrganizationTestArrivals;
    admissions: OrganizationAdmissions;
  }): OrganizationMembershipService {
    return new OrganizationMembershipService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      repository: OrganizationMembershipRepository;
      prompts: OrganizationPromptSeed;
      seats: OrganizationSeatLicense;
      sessions: OrganizationSessionRevocation;
      grantCache: OrganizationGrantCache;
      testArrivals: OrganizationTestArrivals;
      admissions: OrganizationAdmissions;
    },
  ) {
    this.roles = OrganizationMemberRoleService.create(dependencies);
  }

  private readonly roles: OrganizationMemberRoleService;

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  async findUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.findUserOrgRoleByTeamId(params);
  }

  /**
   * The org's declared primary intent (ADR-038); null = intent unset
   * (legacy org). Consumed by the home resolver to pin the "/" landing.
   */
  async findPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    try {
      const { primaryIntent } = await this.repo.getOrganizationIntent(organizationId);
      return primaryIntent;
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "organization_not_found") return null;
      throw error;
    }
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
    // A TEST SIGN-IN IS NOT A SIGNUP, and this is the one door: onboarding's
    // own mutation delegates here, so a check up there is one this call walks
    // straight past. Creating an organization for the tester strands the real
    // organization's setup inside a second, empty one.
    const arrival = await this.dependencies.testArrivals.standingFor({ userId: params.userId });
    if (arrival.testing) {
      throw new SsoTestArrivalCannotCreateOrganizationError(
        `session opened through connection ${arrival.connectionId}, which is not live`,
      );
    }

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

  /**
   * The organization a self-hosted licence is issued to, created with its
   * first team exactly as provisioning creates one, then marked as a customer.
   */
  async createSelfHostedCustomer({
    name,
  }: {
    name: string;
  }): Promise<{ id: string; name: string }> {
    const { organization } = await this.createForProvisioning({ name });
    await this.repo.markSelfHostedCustomer(organization.id);

    return organization;
  }

  /** Marks an existing organization as a self-hosted licence customer. */
  markSelfHostedCustomer({ organizationId }: { organizationId: string }): Promise<void> {
    return this.repo.markSelfHostedCustomer(organizationId);
  }

  findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    return this.repo.findSelfHostedCustomers();
  }

  findRepresentatives({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; organizationName: string }[]> {
    return this.repo.findRepresentatives(organizationId);
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
  async findProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    try {
      return await this.repo.getProvisioningSummaryById(organizationId);
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "organization_not_found") return null;
      throw error;
    }
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
    return this.repo.findAllForUser(params);
  }

  /**
   * Returns an organization with its members and their team memberships.
   * Returns null when the user is not a member of the organization.
   */
  async findOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.repo.findOrganizationWithMembers(params);
  }

  /**
   * Returns a single organization member by userId, verifying the current user's access.
   * Returns null when the current user is not a member (not found) or the target member
   * does not exist.
   */
  async findMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    return this.repo.findMemberById(params);
  }

  /**
   * Returns all active (non-deactivated) users in an organization.
   */
  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.repo.findActiveMemberUsers(organizationId);
  }

  /** Every member row, disabled and deactivated included (main's governance identity read). */
  findMembersIncludingDeactivated(input: { organizationId: string }): Promise<User[]> {
    return this.repo.findMemberUsersIncludingDeactivated(input);
  }

  /** Every administrator who can still sign in, named. Both halves are read
   *  here rather than joined in a query: who is an administrator and who can
   *  sign in are two different rules, and one is the ledger's. */
  async findAdministrators({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationAdministrator[]> {
    const administrators = new Set(await this.repo.findActiveAdministratorIds({ organizationId }));
    const members = await this.repo.findActiveMemberUsers(organizationId);

    return members
      .filter((member) => administrators.has(member.id))
      .map((member) => ({
        userId: member.id,
        name: member.name ?? null,
        email: member.email ?? null,
      }));
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
    return this.repo.listAllMembers({
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
    const membership = await this.repo.getMembership(params);
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

    await this.repo.getMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });

    return this.repo.deleteMember({
      organizationId: params.organizationId,
      userId: params.userId,
      actingUserId: params.actingUserId ?? null,
    });
  }

  /** Makes somebody a MEMBER, minting the grant intent an unfinished
   *  admission is resumed from into the same row, in the ledger's own
   *  scheme because the intent's identity is the ledger's (ADR-129). */
  async createMembership({
    organizationId,
    userId,
    admittedBy,
  }: {
    organizationId: string;
    userId: string;
    admittedBy?: Readonly<{ actor: GrantsLedgerActor; commandId: string }>;
  }): Promise<"created" | "already-present"> {
    const grantId = newAuthzBindingId();
    const outcome = await this.repo.createMembership({
      organizationId,
      userId,
      pendingAdmissionId: grantId,
    });
    if (outcome !== "created" || !admittedBy) return outcome;

    // A join lands its grant here, audited to whoever admitted it: `join-request`
    // is deliberately auditable, so an automatic join reads like a clicked one.
    await this.dependencies.admissions.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: grantId,
          principal: { userId },
          role: "MEMBER",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      ],
      actor: admittedBy.actor,
      source: "join-request",
      onDuplicate: "skip",
      commandId: admittedBy.commandId,
      requireProjection: true,
    });
    await this.dependencies.admissions.completeAdmission({ organizationId, userId, grantId });
    return outcome;
  }

  /** Refuses when taking this member out would leave the organization with no
   *  administrator who can sign in — the one lockout nothing inside the product
   *  can undo. Asked by callers whose own path writes the membership row. */
  async assertRemovalKeepsAnAdministrator(params: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const membership = await this.repo.getMembership(params).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "member_not_found") return undefined;
      throw error;
    });
    // Not a member, or not an administrator who can sign in: there is no
    // administrator to lose, so there is nothing to refuse.
    if (!membership) return;
    if (membership.role !== OrganizationUserRole.ADMIN || membership.disabledAt !== null) return;

    const administrators = await this.repo.findActiveAdministratorIds({
      organizationId: params.organizationId,
    });
    if (administrators.some((administrator) => administrator !== params.userId)) return;

    throw new CannotRemoveLastAdminError();
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
