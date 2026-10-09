import { type AuthzGrantCaller } from "@langwatch/authz-contract";
/**
 * The organization surface the canonical contract does not carry: membership,
 * seats, role cascades, provisioning and the audit trail.
 */
import { HandledError } from "@langwatch/handled-error";
import type { SsoTestArrivalStanding } from "@langwatch/identity-contract";
import {
  type OrganizationAdministrator,
  type OrganizationIntent,
  type OrganizationUserRole,
  type User,
  type FullyLoadedOrganization,
  type OrganizationWithMembersAndTheirTeams,
  MemberNotFoundError,
  MemberSeatLimitReachedError,
} from "@langwatch/organization-contract";
import type { Instant } from "@langwatch/time";

import type {
  AuditLogFilters,
  EnrichedAuditLog,
  MemberTeamBinding,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationMembershipRepository,
} from "../repositories/organization-membership.repository.ts";
import { readSeatRefusal } from "../rules/seat-limit-refusal.rules.ts";
import { enrichTeamWithGrants } from "../rules/team-grant-enrichment.rules.ts";
import type { OrganizationGrantCeilingService } from "./organization-grant-ceiling.service.ts";
import {
  OrganizationMemberAdmissionService,
  type OrganizationAdmissions,
  type OrganizationMemberChangeNotice,
  type PersonalWorkspaceArchiveNotice,
} from "./organization-member-admission.service.ts";
import type {
  OrganizationGrantCache,
  OrganizationSeatRevocationNotice,
} from "./organization-member-role.service.ts";
import { OrganizationMemberRoleService } from "./organization-member-role.service.ts";
import {
  OrganizationProvisioningService,
  type OrganizationCreationNotice,
} from "./organization-provisioning.service.ts";
import type {
  OrganizationSeatLicense,
  OrganizationPlanUser,
} from "./organization-seat-license.service.ts";

/**
 * Whether this person is mid-way through proving a single sign-on connection
 * rather than starting out. Identity's answer, since it owns the connection
 * and the account the test sign-in left behind (ADR-129).
 */
export interface OrganizationTestArrivals {
  standingFor(args: { userId: string }): Promise<SsoTestArrivalStanding>;
}

/**
 * The membership, provisioning and audit operations, over one repository and
 * four ports.
 */
export class OrganizationMembershipService {
  static readonly enrichTeamWithGrants = enrichTeamWithGrants;

  static create(dependencies: {
    repository: OrganizationMembershipRepository;
    creations: OrganizationCreationNotice;
    seats: OrganizationSeatLicense;
    seatNotices: OrganizationSeatRevocationNotice;
    grantCache: OrganizationGrantCache;
    testArrivals: OrganizationTestArrivals;
    admissions: OrganizationAdmissions;
    workspaceNotices: PersonalWorkspaceArchiveNotice;
    memberNotices: OrganizationMemberChangeNotice;
    /** Authz's escalation rule, asked before a role change writes anything. */
    ceiling: Pick<OrganizationGrantCeilingService, "assertWithinCaller">;
  }): OrganizationMembershipService {
    return new OrganizationMembershipService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      repository: OrganizationMembershipRepository;
      creations: OrganizationCreationNotice;
      seats: OrganizationSeatLicense;
      seatNotices: OrganizationSeatRevocationNotice;
      grantCache: OrganizationGrantCache;
      testArrivals: OrganizationTestArrivals;
      admissions: OrganizationAdmissions;
      workspaceNotices: PersonalWorkspaceArchiveNotice;
      memberNotices: OrganizationMemberChangeNotice;
      /** Authz's escalation rule, asked before a role change writes anything. */
      ceiling: Pick<OrganizationGrantCeilingService, "assertWithinCaller">;
    },
  ) {
    this.roles = OrganizationMemberRoleService.create(dependencies);
    this.provisioning = OrganizationProvisioningService.create(dependencies);
    this.admission = OrganizationMemberAdmissionService.create(dependencies);
  }

  private readonly roles: OrganizationMemberRoleService;
  private readonly provisioning: OrganizationProvisioningService;
  private readonly admission: OrganizationMemberAdmissionService;

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  async findUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.repo.findUserOrgRoleByTeamId(params);
  }

  /** The person's organisation role, or null where they are not a member. */
  async findOrganizationRole(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationUserRole | null> {
    try {
      return (await this.repo.getMembership(params)).role;
    } catch (error) {
      if (error instanceof MemberNotFoundError) return null;
      throw error;
    }
  }

  /** Refuses a Lite Member's team-role change the organization has no seat for. */
  assertTeamRoleChangeWithinSeatLimits(params: {
    organizationId: string;
    teamId: string;
    userId: string;
  }): Promise<void> {
    return this.roles.assertTeamRoleChangeWithinSeatLimits(params);
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

  createAndAssign(
    params: Parameters<OrganizationProvisioningService["createAndAssign"]>[0],
  ): ReturnType<OrganizationProvisioningService["createAndAssign"]> {
    return this.provisioning.createAndAssign(params);
  }

  createForProvisioning(
    params: Parameters<OrganizationProvisioningService["createForProvisioning"]>[0],
  ): ReturnType<OrganizationProvisioningService["createForProvisioning"]> {
    return this.provisioning.createForProvisioning(params);
  }

  createSelfHostedCustomer(
    params: Parameters<OrganizationProvisioningService["createSelfHostedCustomer"]>[0],
  ): ReturnType<OrganizationProvisioningService["createSelfHostedCustomer"]> {
    return this.provisioning.createSelfHostedCustomer(params);
  }

  markSelfHostedCustomer(
    params: Parameters<OrganizationProvisioningService["markSelfHostedCustomer"]>[0],
  ): ReturnType<OrganizationProvisioningService["markSelfHostedCustomer"]> {
    return this.provisioning.markSelfHostedCustomer(params);
  }

  findSelfHostedCustomers(): ReturnType<
    OrganizationProvisioningService["findSelfHostedCustomers"]
  > {
    return this.provisioning.findSelfHostedCustomers();
  }

  findFoundedBetween(
    params: Parameters<OrganizationProvisioningService["findFoundedBetween"]>[0],
  ): ReturnType<OrganizationProvisioningService["findFoundedBetween"]> {
    return this.provisioning.findFoundedBetween(params);
  }

  findRepresentatives(
    params: Parameters<OrganizationProvisioningService["findRepresentatives"]>[0],
  ): ReturnType<OrganizationProvisioningService["findRepresentatives"]> {
    return this.provisioning.findRepresentatives(params);
  }

  listProvisioningSummaries(): ReturnType<
    OrganizationProvisioningService["listProvisioningSummaries"]
  > {
    return this.provisioning.listProvisioningSummaries();
  }

  deleteProvisionedOrganization(
    params: Parameters<OrganizationProvisioningService["deleteProvisionedOrganization"]>[0],
  ): ReturnType<OrganizationProvisioningService["deleteProvisionedOrganization"]> {
    return this.provisioning.deleteProvisionedOrganization(params);
  }

  findProvisioningSummary(
    params: Parameters<OrganizationProvisioningService["findProvisioningSummary"]>[0],
  ): ReturnType<OrganizationProvisioningService["findProvisioningSummary"]> {
    return this.provisioning.findProvisioningSummary(params);
  }

  getProvisioningSummary(
    params: Parameters<OrganizationProvisioningService["getProvisioningSummary"]>[0],
  ): ReturnType<OrganizationProvisioningService["getProvisioningSummary"]> {
    return this.provisioning.getProvisioningSummary(params);
  }

  /**
   * Returns fully loaded organizations for a user, their S3 endpoint and access key opened by the
   * repository; the visibility service redacts the rest before anything leaves.
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

  findMembersWithDepartments(input: { organizationId: string }): Promise<
    {
      userId: string;
      departmentId: string | null;
      disabledAt: Instant | null;
      user: { name: string | null; email: string | null };
    }[]
  > {
    return this.repo.findMembersWithDepartments(input);
  }

  async assignMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    if (!(await this.repo.assignMemberDepartment(input))) return false;
    await this.dependencies.memberNotices.memberDepartmentChanged(input);
    return true;
  }

  findTeamsWithDepartments(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]> {
    return this.repo.findTeamsWithDepartments(input);
  }

  assignTeamDepartment(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.repo.assignTeamDepartment(input);
  }

  findMemberDepartments(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string | null }[]> {
    return this.repo.findMemberDepartments(input);
  }

  findMemberTeamIds(input: { organizationId: string; userId: string }): Promise<string[]> {
    return this.repo.findMemberTeamIds(input);
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

  /** The plain MEMBER row an SSO domain auto-join writes (ADR-116); the caller grants it. */
  createSsoDomainMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<"created" | "already-present"> {
    return this.repo.createSsoDomainMembership(input);
  }

  countMembershipsForUser(input: { userId: string }): Promise<number> {
    return this.repo.countMembershipsForUser(input);
  }

  deleteMember(
    params: Parameters<OrganizationMemberAdmissionService["deleteMember"]>[0],
  ): ReturnType<OrganizationMemberAdmissionService["deleteMember"]> {
    return this.admission.deleteMember(params);
  }

  createMembership(
    params: Parameters<OrganizationMemberAdmissionService["createMembership"]>[0],
  ): ReturnType<OrganizationMemberAdmissionService["createMembership"]> {
    return this.admission.createMembership(params);
  }

  assertRemovalKeepsAnAdministrator(
    params: Parameters<OrganizationMemberAdmissionService["assertRemovalKeepsAnAdministrator"]>[0],
  ): ReturnType<OrganizationMemberAdmissionService["assertRemovalKeepsAnAdministrator"]> {
    return this.admission.assertRemovalKeepsAnAdministrator(params);
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

  /**
   * Changes exactly one of a member's role or disabled status, then reads the member back with
   * the teams a role change left without an administrator.
   */
  async updateMember(params: {
    organizationId: string;
    userId: string;
    role?: OrganizationUserRole;
    disabled?: boolean;
    /** The user the credential acts as; null for a service key. */
    actingUser: OrganizationPlanUser | null;
    /** Whose holdings bound the grants a role change writes. */
    caller: AuthzGrantCaller;
  }): Promise<
    OrganizationMemberSummary & {
      teams: MemberTeamBinding[];
      teamsLeftWithoutAdmin: { id: string; name: string }[];
    }
  > {
    const { organizationId, userId, role, actingUser } = params;
    let teamsLeftWithoutAdmin: { id: string; name: string }[] = [];

    try {
      if (role !== undefined) {
        const result = await this.roles.changeMemberRole({
          organizationId,
          userId,
          role,
          currentUserId: actingUser?.id ?? null,
          caller: params.caller,
          ...(actingUser ? { planUser: actingUser } : {}),
        });
        teamsLeftWithoutAdmin = [...result.teamsLeftWithoutAdmin];
      } else {
        await this.roles.setMemberDisabled({
          organizationId,
          userId,
          disabled: params.disabled === true,
          actingUser,
        });
      }
    } catch (error) {
      // The management surface's one wire code for "no seat left", as main's rethrowSeatLimit.
      const refusal = readSeatRefusal(error);
      if (refusal.kind === "other") throw error;
      const { limit } = refusal;
      throw new MemberSeatLimitReachedError({ meta: limit });
    }

    return { ...(await this.getMember({ organizationId, userId })), teamsLeftWithoutAdmin };
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
