import {
  CannotDemoteLastAdminError,
  CannotDisableLastAdminError,
  CannotRemoveLastAdminError,
  MemberNotFoundError,
  OrganizationSlugTakenError,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamNotFoundError,
  type Organization,
  type OrganizationIntent,
  type TeamUserRole,
  type User,
} from "@langwatch/organization-contract";
import type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  CreateForProvisioningInput,
  DeleteMemberInput,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  MemberTeamBinding,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationMembershipRepository,
  OrganizationProvisioningSummary,
  OrganizationWithMembersAndTheirTeams,
  SetMemberDisabledInput,
  UpdateMemberRoleInput,
  UpdateMemberRoleResult,
  UpdateTeamMemberRoleInput,
} from "../organization-membership.repository.ts";
import type {
  MemoryOrganizationDatabase,
  MemoryOrganizationRow,
  MemoryTeamRow,
  MemoryUserRow,
} from "./memory.organization.database.ts";

function toOrganization(row: MemoryOrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    phoneNumber: null,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageSpendingMaxLimit: null,
    maxSessionDurationDays: 30,
    mfaRequired: false,
    signupData: null,
    signedDPA: false,
    elasticsearchNodeUrl: null,
    elasticsearchApiKey: null,
    useCustomElasticsearch: false,
    s3Endpoint: row.s3Endpoint,
    s3AccessKeyId: row.s3AccessKeyId,
    s3SecretAccessKey: row.s3SecretAccessKey,
    s3Bucket: row.s3Bucket,
    useCustomS3: false,
    sentPlanLimitAlert: null,
    ssoDomain: null,
    ssoProvider: null,
    domainJoin: "invite_only",
    joinDomains: [],
    presenceEnabled: row.presenceEnabled,
    traceSharingEnabled: row.traceSharingEnabled,
    supportContact: row.supportContact,
    primaryIntent: row.primaryIntent,
    promoCode: null,
    stripeCustomerId: row.stripeCustomerId,
    currency: "USD",
    pricingModel: "SEAT_EVENT",
    license: null,
    licenseExpiresAt: null,
    licenseLastValidatedAt: null,
  };
}

function toUser(row: MemoryUserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    userHashKey: null,
    twoFactorEnabled: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: row.deactivatedAt,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
    passkeyNudgeDismissedAt: null,
  };
}

/**
 * In-memory `OrganizationMembershipRepository`, for tests and a memory-backed
 * boot. Covers every method the abstract class declares; the transactional
 * admin-lockout guards the Postgres repository locks a row for are answered
 * here with a plain read, since a memory backend has no concurrent writer to
 * race against.
 */
export class MemoryOrganizationMembershipRepository implements OrganizationMembershipRepository {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {}

  static create(options: {
    memory: MemoryOrganizationDatabase;
  }): MemoryOrganizationMembershipRepository {
    return new MemoryOrganizationMembershipRepository(options.memory);
  }

  async tryGetUserOrgRole(params: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null> {
    const row = this.membershipRow(params);
    if (!row || row.disabledAt) return null;
    return row.role;
  }

  async tryGetUserOrgRoleByTeamId(params: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    const team = this.memory.teams.get(params.teamId);
    if (!team) return null;
    return this.tryGetUserOrgRole({ userId: params.userId, organizationId: team.organizationId });
  }

  async tryFindPrimaryIntentById(organizationId: string): Promise<OrganizationIntent | null> {
    return this.memory.organizations.get(organizationId)?.primaryIntent ?? null;
  }

  async createAndAssign(input: CreateAndAssignInput): Promise<CreateAndAssignResult> {
    if (this.findOrganizationBySlug(input.orgSlug)) {
      throw new OrganizationSlugTakenError(input.orgSlug);
    }
    const now = new Date();
    this.memory.organizations.set(input.orgId, {
      id: input.orgId,
      name: input.orgName,
      slug: input.orgSlug,
      supportContact: null,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: input.primaryIntent ?? null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    });
    this.memory.organizationUsers.push({
      userId: input.userId,
      organizationId: input.orgId,
      role: OrganizationUserRole.ADMIN,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const team = this.createTeamRow({
      teamId: input.teamId,
      name: input.orgName,
      slug: input.teamSlug,
      organizationId: input.orgId,
    });
    this.memory.teamUsers.push({
      teamId: team.id,
      userId: input.userId,
      role: "ADMIN" as TeamUserRole,
      customRoleId: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      organization: { id: input.orgId, name: input.orgName },
      team: { id: team.id, slug: team.slug, name: team.name },
    };
  }

  async createForProvisioning(input: CreateForProvisioningInput): Promise<CreateAndAssignResult> {
    if (this.findOrganizationBySlug(input.orgSlug)) {
      throw new OrganizationSlugTakenError(input.orgSlug);
    }
    const now = new Date();
    this.memory.organizations.set(input.orgId, {
      id: input.orgId,
      name: input.orgName,
      slug: input.orgSlug,
      supportContact: null,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    });
    const team = this.createTeamRow({
      teamId: input.teamId,
      name: input.orgName,
      slug: input.teamSlug,
      organizationId: input.orgId,
    });

    return {
      organization: { id: input.orgId, name: input.orgName },
      team: { id: team.id, slug: team.slug, name: team.name },
    };
  }

  async findAllProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    return [...this.memory.organizations.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      }));
  }

  async tryFindProvisioningSummaryById(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    const organization = this.memory.organizations.get(organizationId);
    if (!organization) return null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
    };
  }

  async deleteProvisionedOrganization(organizationId: string): Promise<void> {
    for (const team of this.teamsOf(organizationId)) this.memory.teams.delete(team.id);
    this.memory.organizationUsers.splice(
      0,
      this.memory.organizationUsers.length,
      ...this.memory.organizationUsers.filter((row) => row.organizationId !== organizationId),
    );
    this.memory.organizations.delete(organizationId);
  }

  async getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    const memberOrgIds = new Set(
      this.memory.organizationUsers
        .filter((row) => row.userId === params.userId && row.disabledAt === null)
        .map((row) => row.organizationId),
    );
    if (params.isDemo) {
      const demoProject = this.memory.projects.get(params.demoProjectId);
      const demoTeam = demoProject ? this.memory.teams.get(demoProject.teamId) : undefined;
      if (demoTeam && demoTeam.archivedAt === null) memberOrgIds.add(demoTeam.organizationId);
    }

    return [...this.memory.organizations.values()]
      .filter((organization) => memberOrgIds.has(organization.id))
      .map((organization) => this.fullyLoadedOrganization(organization, params.userId));
  }

  async tryGetOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    const caller = this.membershipRow({
      userId: params.userId,
      organizationId: params.organizationId,
    });
    if (!caller || caller.disabledAt) return null;
    const organization = this.memory.organizations.get(params.organizationId);
    if (!organization) return null;

    const members = this.memory.organizationUsers
      .filter((row) => row.organizationId === params.organizationId)
      .filter((row) => {
        if (params.includeDeactivated) return true;
        const user = this.memory.users.get(row.userId);
        return !user || user.deactivatedAt === null;
      })
      .map((row) => this.memberWithUser(row));

    return { ...toOrganization(organization), members };
  }

  async tryGetMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    const caller = this.membershipRow({
      userId: params.currentUserId,
      organizationId: params.organizationId,
    });
    if (!caller || caller.disabledAt) return null;
    const row = this.membershipRow({ userId: params.userId, organizationId: params.organizationId });
    if (!row) return null;
    return this.memberWithUser(row);
  }

  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.memory.organizationUsers
      .filter((row) => row.organizationId === organizationId && row.disabledAt === null)
      .map((row) => this.userRow(row.userId))
      .filter((user) => user.deactivatedAt === null)
      .map(toUser);
  }

  async tryFindMembership(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary | null> {
    const row = this.membershipRow(params);
    if (!row) return null;
    return this.memberSummary(row);
  }

  async findAllMembers(params: {
    organizationId: string;
    includeDisabled: boolean;
    offset: number;
    limit: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    const all = this.memory.organizationUsers
      .filter((row) => row.organizationId === params.organizationId)
      .filter((row) => params.includeDisabled || row.disabledAt === null)
      .sort((a, b) => a.userId.localeCompare(b.userId));
    const page = all.slice(params.offset, params.offset + params.limit);
    return { members: page.map((row) => this.memberSummary(row)), totalCount: all.length };
  }

  async findMemberTeamBindings(params: {
    organizationId: string;
    userId: string;
  }): Promise<MemberTeamBinding[]> {
    return this.memory.teamUsers
      .filter((row) => row.userId === params.userId)
      .flatMap((row) => {
        const team = this.memory.teams.get(row.teamId);
        if (!team || team.organizationId !== params.organizationId || team.isPersonal) return [];
        const customRole = row.customRoleId ? this.memory.customRoles.get(row.customRoleId) : null;
        return [
          {
            teamId: team.id,
            teamName: team.name,
            role: row.role,
            customRoleId: row.customRoleId,
            customRoleName: customRole?.name ?? null,
          },
        ];
      });
  }

  async deleteMember(input: DeleteMemberInput): Promise<void> {
    const { organizationId, userId } = input;
    const row = this.membershipRow({ organizationId, userId });
    if (!row) throw new MemberNotFoundError(userId);
    await this.assertRemovalKeepsAnActiveAdmin({ organizationId, member: row });

    this.memory.organizationUsers.splice(
      0,
      this.memory.organizationUsers.length,
      ...this.memory.organizationUsers.filter(
        (candidate) => !(candidate.organizationId === organizationId && candidate.userId === userId),
      ),
    );
    this.memory.teamUsers.splice(
      0,
      this.memory.teamUsers.length,
      ...this.memory.teamUsers.filter((candidate) => candidate.userId !== userId),
    );

    const archivedAt = new Date();
    for (const team of this.teamsOf(organizationId)) {
      if (team.ownerUserId !== userId || !team.isPersonal || team.archivedAt) continue;
      team.archivedAt = archivedAt;
      for (const project of this.memory.projects.values()) {
        if (project.teamId === team.id && project.isPersonal) project.archivedAt = archivedAt;
      }
    }
  }

  async setMemberDisabled(input: SetMemberDisabledInput): Promise<void> {
    const row = this.membershipRow(input);
    if (!row) throw new MemberNotFoundError(input.userId);
    if (input.disabled && row.role === OrganizationUserRole.ADMIN) {
      const activeAdmins = this.activeAdminCount(input.organizationId);
      if (activeAdmins <= 1) throw new CannotDisableLastAdminError();
    }
    row.disabledAt = input.disabled ? new Date() : null;
    row.updatedAt = new Date();
  }

  async tryFindPersonalTeamInScopes(params: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<{ name: string } | null> {
    const teamIds = params.scopes
      .filter((scope) => scope.scopeType === RoleBindingScopeType.TEAM)
      .map((scope) => scope.scopeId);
    for (const teamId of teamIds) {
      const team = this.memory.teams.get(teamId);
      if (team?.isPersonal) return { name: team.name };
    }
    const projectIds = params.scopes
      .filter((scope) => scope.scopeType === RoleBindingScopeType.PROJECT)
      .map((scope) => scope.scopeId);
    for (const projectId of projectIds) {
      const project = this.memory.projects.get(projectId);
      const team = project ? this.memory.teams.get(project.teamId) : undefined;
      if (project?.isPersonal || team?.isPersonal) {
        if (team) return { name: team.name };
      }
    }
    return null;
  }

  async findSharedTeamIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.teamsOf(organizationId)
      .filter((team) => !team.isPersonal)
      .map((team) => team.id);
  }

  async findTeamRoleBindings({
    organizationId,
    userId,
    teamIds,
  }: {
    organizationId: string;
    userId: string;
    teamIds: string[];
  }): Promise<Array<{ scopeId: string; role: TeamUserRole; customRoleId: string | null }>> {
    return this.memory.teamUsers
      .filter((row) => row.userId === userId && teamIds.includes(row.teamId))
      .filter((row) => this.memory.teams.get(row.teamId)?.organizationId === organizationId)
      .map((row) => ({ scopeId: row.teamId, role: row.role, customRoleId: row.customRoleId }));
  }

  async findCustomRolePermissions({
    organizationId,
    customRoleIds,
  }: {
    organizationId: string;
    customRoleIds: string[];
  }): Promise<unknown[]> {
    return customRoleIds.flatMap((id) => {
      const role = this.memory.customRoles.get(id);
      return role && role.organizationId === organizationId ? [role.permissions] : [];
    });
  }

  async updateMemberRole(input: UpdateMemberRoleInput): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, effectiveTeamRoleUpdates } = input;
    const row = this.membershipRow({ organizationId, userId });
    if (!row) throw new MemberNotFoundError(userId);

    if (role !== OrganizationUserRole.ADMIN && row.role === OrganizationUserRole.ADMIN) {
      if (this.activeAdminCount(organizationId, { includeDisabled: true }) <= 1) {
        throw new CannotDemoteLastAdminError();
      }
    }
    row.role = role;
    row.updatedAt = new Date();

    const teamsLeftWithoutAdmin: Array<{ id: string; name: string }> = [];
    for (const update of effectiveTeamRoleUpdates) {
      const teamUser = this.memory.teamUsers.find(
        (candidate) => candidate.teamId === update.teamId && candidate.userId === userId,
      );
      if (!teamUser) continue;
      teamUser.role = update.role as TeamUserRole;
      teamUser.customRoleId = update.customRoleId ?? null;
      teamUser.updatedAt = new Date();
    }

    if (this.activeAdminCount(organizationId, { includeDisabled: true }) === 0) {
      throw new CannotDemoteLastAdminError();
    }

    return { teamsLeftWithoutAdmin };
  }

  async updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void> {
    const { teamId, userId, role, customRoleId } = input;
    const team = this.memory.teams.get(teamId);
    if (!team) throw new TeamNotFoundError(teamId);
    const teamUser = this.memory.teamUsers.find(
      (candidate) => candidate.teamId === teamId && candidate.userId === userId,
    );
    if (!teamUser) throw new MemberNotFoundError(userId);
    teamUser.role = (customRoleId ? "CUSTOM" : role) as TeamUserRole;
    teamUser.customRoleId = customRoleId ?? null;
    teamUser.updatedAt = new Date();
  }

  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    const rows = this.memory.auditLogs
      .filter((row) => row.organizationId === filters.organizationId)
      .filter((row) => !filters.userId || row.userId === filters.userId)
      .filter((row) => !filters.projectId || row.projectId === filters.projectId)
      .filter((row) => !filters.action || row.action.includes(filters.action))
      .filter((row) => !filters.targetKind || row.targetKind === filters.targetKind)
      .filter((row) => !filters.targetId || row.targetId === filters.targetId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const page = rows.slice(filters.pageOffset, filters.pageOffset + filters.pageSize);

    return {
      totalCount: rows.length,
      auditLogs: page.map((row) => {
        const isGateway = row.action.startsWith("gateway.");
        const user = row.userId ? this.memory.users.get(row.userId) : undefined;
        const project = row.projectId ? this.memory.projects.get(row.projectId) : undefined;
        return {
          id: row.id,
          createdAt: row.createdAt,
          userId: row.userId,
          organizationId: row.organizationId,
          projectId: row.projectId,
          action: row.action,
          payload: isGateway ? (row.after ?? row.before ?? null) : row.payload,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          error: row.error,
          args: isGateway ? { before: row.before, after: row.after } : row.args,
          user: user ? { id: user.id, name: user.name, email: user.email } : null,
          project: project ? { id: project.id, name: project.name } : null,
          source: isGateway ? "gateway" : "platform",
          targetKind: row.targetKind,
          targetId: row.targetId,
          before: row.before,
          after: row.after,
        };
      }),
    };
  }

  // -- shared reads ------------------------------------------------------

  private membershipRow(params: { organizationId: string; userId: string }) {
    return this.memory.organizationUsers.find(
      (row) => row.organizationId === params.organizationId && row.userId === params.userId,
    );
  }

  /** The joined person, or a bare placeholder for a membership with no seeded user row. */
  private userRow(userId: string): MemoryUserRow {
    return (
      this.memory.users.get(userId) ?? { id: userId, name: null, email: null, deactivatedAt: null }
    );
  }

  private memberSummary(row: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
    disabledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationMemberSummary {
    const user = this.userRow(row.userId);
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      role: row.role,
      disabledAt: row.disabledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.userId, name: user?.name ?? null, email: user?.email ?? null },
    };
  }

  private memberWithUser(row: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
    disabledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationMemberWithUser {
    const user = toUser(this.userRow(row.userId));
    const teamMemberships = this.memory.teamUsers
      .filter((teamUser) => teamUser.userId === row.userId)
      .flatMap((teamUser) => {
        const team = this.memory.teams.get(teamUser.teamId);
        if (!team || team.archivedAt) return [];
        return [
          {
            userId: teamUser.userId,
            teamId: teamUser.teamId,
            role: teamUser.role,
            assignedRoleId: teamUser.customRoleId,
            createdAt: teamUser.createdAt,
            updatedAt: teamUser.updatedAt,
            team: this.teamRowToTeam(team),
            assignedRole: null,
          },
        ];
      });

    return {
      userId: row.userId,
      organizationId: row.organizationId,
      role: row.role,
      disabledAt: row.disabledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      departmentId: null,
      user: { ...user, teamMemberships },
    };
  }

  private fullyLoadedOrganization(
    organization: MemoryOrganizationRow,
    userId: string,
  ): FullyLoadedOrganization {
    const organizationId = organization.id;
    const members = this.memory.organizationUsers
      .filter((row) => row.organizationId === organizationId && row.userId === userId)
      .map((row) => this.memberSummaryAsOrganizationUser(row));
    const teams = this.teamsOf(organizationId)
      .filter((team) => team.archivedAt === null)
      .map((team) => {
        const projects = [...this.memory.projects.values()].filter(
          (project) => project.teamId === team.id && project.archivedAt === null,
        );
        const teamMembers = this.memory.teamUsers
          .filter((teamUser) => teamUser.teamId === team.id)
          .map((teamUser) => ({
            userId: teamUser.userId,
            teamId: teamUser.teamId,
            role: teamUser.role,
            assignedRoleId: teamUser.customRoleId,
            createdAt: teamUser.createdAt,
            updatedAt: teamUser.updatedAt,
            assignedRole: null,
          }));
        return {
          ...this.teamRowToTeam(team),
          projects: projects.map((project) => this.projectRowToRow(project)),
          members: teamMembers,
        };
      });

    return { ...toOrganization(organization), members, teams };
  }

  private memberSummaryAsOrganizationUser(row: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
    disabledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return { ...row, departmentId: null };
  }

  private teamRowToTeam(team: MemoryTeamRow) {
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      organizationId: team.organizationId,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      archivedAt: team.archivedAt,
      isPersonal: team.isPersonal,
      ownerUserId: team.ownerUserId,
      departmentId: null,
    };
  }

  private projectRowToRow(project: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
    isPersonal: boolean;
    ownerUserId: string | null;
    organizationId: string | null;
    archivedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      apiKey: project.apiKey,
      lwqlKey: "",
      teamId: project.teamId,
      language: "",
      framework: "",
      kind: "product",
      firstMessage: false,
      integrated: false,
      createdAt: project.createdAt,
      updatedAt: project.createdAt,
      userLinkTemplate: null,
      traceSharingEnabled: false,
      presenceEnabled: false,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      archivedAt: project.archivedAt,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
      personalFeatures: null,
      departmentId: null,
      langyEgressAllowlist: null,
      lastCodingAgentSessionAt: null,
      lastCodingAgentPullRequestAt: null,
    };
  }

  private teamsOf(organizationId: string): MemoryTeamRow[] {
    return [...this.memory.teams.values()].filter((team) => team.organizationId === organizationId);
  }

  private findOrganizationBySlug(slug: string) {
    return [...this.memory.organizations.values()].find((organization) => organization.slug === slug);
  }

  private activeAdminCount(
    organizationId: string,
    options: { includeDisabled?: boolean } = {},
  ): number {
    return this.memory.organizationUsers.filter(
      (row) =>
        row.organizationId === organizationId &&
        row.role === OrganizationUserRole.ADMIN &&
        (options.includeDisabled || row.disabledAt === null),
    ).length;
  }

  private createTeamRow(input: {
    teamId: string;
    name: string;
    slug: string;
    organizationId: string;
  }): MemoryTeamRow {
    const now = new Date();
    const team: MemoryTeamRow = {
      id: input.teamId,
      name: input.name,
      slug: input.slug,
      organizationId: input.organizationId,
      isPersonal: false,
      ownerUserId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memory.teams.set(team.id, team);
    return team;
  }

  private async assertRemovalKeepsAnActiveAdmin({
    organizationId,
    member,
  }: {
    organizationId: string;
    member: { role: OrganizationUserRole; disabledAt: Date | null };
  }): Promise<void> {
    if (member.role !== OrganizationUserRole.ADMIN || member.disabledAt !== null) return;
    if (this.activeAdminCount(organizationId) <= 1) throw new CannotRemoveLastAdminError();
  }
}
