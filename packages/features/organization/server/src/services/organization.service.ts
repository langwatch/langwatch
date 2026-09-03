import {
  AuthzLedgerUnavailableError,
  DuplicateBindingError,
  type AuthzGrantsService,
  type AuthzService,
  type AuthzAccessBinding,
  type AuthzTeamMemberBinding,
  bindingScopeCanGrantPermission,
} from "@langwatch/authz-contract";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  OrganizationService as OrganizationServiceContract,
  OrganizationNotFoundError,
  GroupBindingAlreadyExistsError,
  GroupBindingNotFoundError,
  GroupCustomRoleRequiredError,
  GroupRoleNotAssignableError,
  GroupRoleScopeError,
  GroupScopeNotInOrganizationError,
  ScimManagedGroupError,
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  PersonalTeamProtectedError,
  PersonalProjectOwnerMismatchError,
  PersonalWorkspaceNotManagedHereError,
  TeamMemberAlreadyAddedError,
  TeamNotFoundError,
  TeamMembershipNotFoundError,
  UserNotInOrganizationError,
  TeamLastAdminRequiredError,
  TeamCustomRoleNotAssignableError,
  TeamCustomRoleRequiredError,
  CannotRemoveSelfAsLastAdminError,
  TeamSlugConflictError,
  addOrganizationGroupBindingInputSchema,
  addOrganizationTeamMemberInputSchema,
  applyOrganizationGroupEditsInputSchema,
  changeOrganizationGroupMemberInputSchema,
  claimOrganizationBillingCustomerInputSchema,
  createOrganizationGroupInputSchema,
  createOrganizationTeamInputSchema,
  createOrganizationTeamWithMembersInputSchema,
  deleteOrganizationGroupInputSchema,
  findPersonalWorkspaceInputSchema,
  getOrganizationGroupInputSchema,
  getOrganizationTeamInputSchema,
  getOrganizationTeamByIdInputSchema,
  getOrganizationTeamBySlugForMemberInputSchema,
  getOrganizationTeamWithMembersInputSchema,
  getOldestTeamInputSchema,
  getOrganizationBillingProfileInputSchema,
  getOrganizationIdByTeamIdInputSchema,
  getOrganizationMembersInputSchema,
  getOrganizationSettingsInputSchema,
  listMemberOrganizationGroupsInputSchema,
  listOrganizationGroupsInputSchema,
  listOrganizationTeamsInputSchema,
  listOrganizationTeamsWithMembersInputSchema,
  listOrganizationTeamAccessInputSchema,
  personalWorkspaceFeaturesInputSchema,
  personalWorkspaceInputSchema,
  readPersonalFeatures,
  changeOrganizationTeamMemberInputSchema,
  removeOrganizationGroupBindingInputSchema,
  renameOrganizationGroupInputSchema,
  updateOrganizationTeamInputSchema,
  updateOrganizationTeamWithMembersInputSchema,
  updateOrganizationSettingsInputSchema,
  type AddOrganizationGroupBindingInput,
  type AddOrganizationTeamMemberInput,
  type ApplyOrganizationGroupEditsInput,
  type ChangeOrganizationGroupMemberInput,
  type ClaimOrganizationBillingCustomerInput,
  type CreateOrganizationGroupInput,
  type CreateOrganizationTeamInput,
  type CreateOrganizationTeamWithMembersInput,
  type DeleteOrganizationGroupInput,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type GetOrganizationGroupInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type GetOrganizationTeamWithMembersInput,
  type GetOldestTeamInput,
  type GetOrganizationBillingProfileInput,
  type GetOrganizationIdByTeamIdInput,
  type GetOrganizationMembersInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type ListOrganizationTeamsInput,
  type ListOrganizationTeamsWithMembersInput,
  type ListOrganizationTeamAccessInput,
  type OrganizationBillingProfile,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type OrganizationGroupBindingInput,
  type OrganizationGroupDetails,
  type OrganizationGroupMember,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type OrganizationTeam,
  type OrganizationLedgerActor,
  type OrganizationTeamAccess,
  type OrganizationTeamAccessMember,
  type OrganizationTeamAccessProject,
  type OrganizationTeamMember,
  type OrganizationTeamMemberInput,
  type OrganizationTeamPage,
  type OrganizationTeamWithMembers,
  type OrganizationSettings,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceFeaturesInput,
  type PersonalWorkspaceInput,
  type RemoveOrganizationGroupBindingInput,
  type RenameOrganizationGroupInput,
  type RemoveOrganizationTeamMemberInput,
  type UpdateOrganizationTeamInput,
  type UpdateOrganizationTeamWithMembersInput,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
} from "@langwatch/organization-contract";
import type {
  GroupIdentityPort,
  OrganizationRepository,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceFeatureProject,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../ports/organization.port";
import type { GroupRepository } from "../repositories/group.repository";
import type { TeamRepository } from "../repositories/team.repository";

const ALL_PERSONAL_FEATURES_DISABLED: PersonalFeatures = {
  evaluations: false,
  datasets: false,
  annotations: false,
  automations: false,
};
const ALL_PERSONAL_FEATURES_ENABLED: PersonalFeatures = {
  evaluations: true,
  datasets: true,
  annotations: true,
  automations: true,
};
const TEAM_ROLE_PRIORITY = {
  ADMIN: 0,
  MEMBER: 1,
  VIEWER: 2,
  CUSTOM: 3,
} as const;

type TeamMembershipPlan = {
  bindingIdsToRemove: string[];
  bindingsToChange: Array<{
    bindingId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
  }>;
  membersToAdd: OrganizationTeamMemberInput[];
};

function memberTarget(member: OrganizationTeamMemberInput): {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId: string | null;
} {
  if (member.role.startsWith("custom:")) {
    return { role: "CUSTOM", customRoleId: member.customRoleId ?? null };
  }
  switch (member.role) {
    case "ADMIN":
    case "MEMBER":
    case "VIEWER":
      return { role: member.role, customRoleId: null };
    default:
      throw new TeamCustomRoleRequiredError();
  }
}

function planTeamMembership(
  currentBindings: AuthzAccessBinding[],
  members: OrganizationTeamMemberInput[],
): TeamMembershipPlan {
  const byUser = new Map<string, AuthzAccessBinding[]>();
  for (const binding of currentBindings) {
    if (!binding.userId) continue;
    const bindings = byUser.get(binding.userId) ?? [];
    bindings.push(binding);
    byUser.set(binding.userId, bindings);
  }
  const requested = new Map(members.map((member) => [member.userId, member]));
  const plan: TeamMembershipPlan = {
    bindingIdsToRemove: [],
    bindingsToChange: [],
    membersToAdd: [],
  };
  for (const [userId, bindings] of byUser) {
    if (!requested.has(userId)) {
      plan.bindingIdsToRemove.push(...bindings.map(({ id }) => id));
    }
  }
  for (const member of members) {
    const bindings = byUser.get(member.userId) ?? [];
    if (bindings.length === 0) {
      plan.membersToAdd.push(member);
      continue;
    }
    const displayed = [...bindings].sort(
      (left, right) => TEAM_ROLE_PRIORITY[left.role] - TEAM_ROLE_PRIORITY[right.role],
    )[0]!;
    const target = memberTarget(member);
    if (displayed.role === target.role && displayed.customRoleId === target.customRoleId) {
      continue;
    }
    const targetAlreadyHeld = bindings.some(
      (binding) =>
        binding.id !== displayed.id &&
        binding.role === target.role &&
        binding.customRoleId === target.customRoleId,
    );
    if (targetAlreadyHeld) {
      plan.bindingIdsToRemove.push(displayed.id);
    } else {
      plan.bindingsToChange.push({ bindingId: displayed.id, ...target });
    }
  }
  return plan;
}

function directAdminIdsAfterPlan(
  currentBindings: AuthzAccessBinding[],
  plan: TeamMembershipPlan,
): Set<string> {
  const removed = new Set(plan.bindingIdsToRemove);
  const changed = new Map(plan.bindingsToChange.map((binding) => [binding.bindingId, binding]));
  const administrators = new Set<string>();
  for (const binding of currentBindings) {
    if (!binding.userId || removed.has(binding.id)) continue;
    if ((changed.get(binding.id)?.role ?? binding.role) === "ADMIN") {
      administrators.add(binding.userId);
    }
  }
  for (const member of plan.membersToAdd) {
    if (memberTarget(member).role === "ADMIN") {
      administrators.add(member.userId);
    }
  }
  return administrators;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

export class OrganizationService extends OrganizationServiceContract {
  private constructor(
    private readonly repository: OrganizationRepository,
    private readonly teams: TeamRepository,
    private readonly groups: GroupRepository,
    private readonly identities: PersonalWorkspaceIdentityPort,
    private readonly teamIdentities: TeamIdentityPort,
    private readonly groupIdentities: GroupIdentityPort,
    private readonly authz: AuthzService,
    private readonly grants: AuthzGrantsService,
    private readonly diagnostics: PersonalWorkspaceDiagnosticsPort | undefined,
  ) {
    super();
  }

  async isMember(input: {
    organizationId: string;
    userId: string;
    includeDeactivated?: boolean;
  }): Promise<boolean> {
    try {
      await this.teams.getOrganizationMembers({
        organizationId: input.organizationId,
        userIds: [input.userId],
        activeOnly: input.includeDeactivated !== true,
      });
      return true;
    } catch (error) {
      if (error instanceof UserNotInOrganizationError) return false;
      throw error;
    }
  }

  /**
   * Which of the named organizations this person belongs to, resolved in one
   * read rather than one per organization.
   *
   * The order the caller asked in is kept and a non-membership is absent, so
   * a caller can map its own list without learning anything about the
   * organizations it is not in.
   */
  memberOrganizationIds(input: { userId: string; organizationIds: string[] }): Promise<string[]> {
    return this.teams.memberOrganizationIds(input);
  }

  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]> {
    return this.teams.getOrganizationMembers(getOrganizationMembersInputSchema.parse(input));
  }

  tryGetOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string | null> {
    return this.teams.tryGetOrganizationId(getOrganizationIdByTeamIdInputSchema.parse(input));
  }

  async getSettings(input: { organizationId: string }): Promise<OrganizationSettings> {
    const parsed = getOrganizationSettingsInputSchema.parse(input);
    const settings = await this.repository.tryFindSettings(parsed.organizationId);
    if (!settings) throw new OrganizationNotFoundError();
    return settings;
  }

  async updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult> {
    const parsed = updateOrganizationSettingsInputSchema.parse(input);
    const wasSharingEnabled =
      parsed.traceSharingEnabled === false
        ? (await this.repository.tryFindStoredSettings(parsed.organizationId))
            ?.traceSharingEnabled === true
        : false;
    await this.repository.updateSettings(parsed);
    return { traceShareRevocationRequired: wasSharingEnabled };
  }

  static create(options: {
    repository: OrganizationRepository;
    teams: TeamRepository;
    groups: GroupRepository;
    identities: PersonalWorkspaceIdentityPort;
    teamIdentities: TeamIdentityPort;
    groupIdentities: GroupIdentityPort;
    authz: AuthzService;
    grants: AuthzGrantsService;
    diagnostics?: PersonalWorkspaceDiagnosticsPort;
  }): OrganizationService {
    return new OrganizationService(
      options.repository,
      options.teams,
      options.groups,
      options.identities,
      options.teamIdentities,
      options.groupIdentities,
      options.authz,
      options.grants,
      options.diagnostics,
    );
  }

  getOldestTeamId(input: GetOldestTeamInput): Promise<string> {
    const parsed = getOldestTeamInputSchema.parse(input);
    return this.repository.getOldestTeamId(parsed.organizationId);
  }

  getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile> {
    return this.repository.getBillingProfile(
      getOrganizationBillingProfileInputSchema.parse(input).organizationId,
    );
  }

  claimBillingCustomerId(input: ClaimOrganizationBillingCustomerInput): Promise<boolean> {
    return this.repository.claimBillingCustomerId(
      claimOrganizationBillingCustomerInputSchema.parse(input),
    );
  }

  async ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    const parsed = personalWorkspaceInputSchema.parse(input);
    const resources = this.identities.create(parsed);
    const result = await this.repository.ensurePersonalWorkspace({
      workspace: parsed,
      resources,
    });
    const grant = {
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      teamId: result.workspace.team.id,
    };
    try {
      await this.grants.attachBindings({
        organizationId: grant.organizationId,
        bindings: [
          {
            bindingId: resources.ownerBindingId,
            principal: { userId: grant.userId },
            role: "ADMIN",
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: grant.teamId,
          },
        ],
        actor: { type: "system", id: SYSTEM_ACTORS.personalWorkspace },
        source: "grants-service",
        onDuplicate: "skip",
        awaitProjection: false,
      });
    } catch (error) {
      if (!(error instanceof AuthzLedgerUnavailableError)) throw error;
      this.diagnostics?.warn(
        "Personal workspace owner grant could not append; the next ensure retries",
        grant,
      );
    }
    return { ...result.workspace, created: result.created };
  }

  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.repository.tryFindPersonalWorkspace(findPersonalWorkspaceInputSchema.parse(input));
  }

  async getPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    const project = await this.getOwnedPersonalWorkspaceProject(input);
    return readPersonalFeatures(project.personalFeatures);
  }

  enableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.setPersonalWorkspaceFeatures(
      input,
      ALL_PERSONAL_FEATURES_ENABLED,
      "personalWorkspaceFeatures.enableAll",
    );
  }

  disableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.setPersonalWorkspaceFeatures(
      input,
      ALL_PERSONAL_FEATURES_DISABLED,
      "personalWorkspaceFeatures.disableAll",
    );
  }

  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamInputSchema.parse(input);
    return this.teams.get(parsed);
  }

  listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage> {
    return this.teams.list(listOrganizationTeamsInputSchema.parse(input));
  }

  async createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = createOrganizationTeamInputSchema.parse(input);
    const identity = this.teamIdentities.createTeam({ name: parsed.name });
    const duplicate = await this.teams.tryFindBySlug({
      organizationId: parsed.organizationId,
      slug: identity.slug,
    });
    if (duplicate) throw new TeamSlugConflictError();
    return this.teams.create({
      organizationId: parsed.organizationId,
      name: parsed.name,
      ...identity,
    });
  }

  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = updateOrganizationTeamInputSchema.parse(input);
    return this.teams.update(parsed);
  }

  async archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamInputSchema.parse(input);
    const team = await this.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_ARCHIVE_REFUSAL);
    }
    return this.teams.archive(parsed);
  }

  async addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    const parsed = addOrganizationTeamMemberInputSchema.parse(input);
    const team = await this.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: [parsed.userId],
    });
    try {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: [
          {
            bindingId: this.teamIdentities.createBindingId(),
            principal: { userId: parsed.userId },
            role: parsed.role,
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: parsed.teamId,
          },
        ],
        actor: parsed.actor,
        onDuplicate: "reject",
      });
    } catch (error) {
      if (error instanceof DuplicateBindingError) {
        throw new TeamMemberAlreadyAddedError(parsed.userId);
      }
      throw error;
    }
  }

  async removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void> {
    const parsed = changeOrganizationTeamMemberInputSchema.parse(input);
    const team = await this.teams.get(parsed);
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }
    const bindings = await this.teamBindings(parsed.organizationId, parsed.teamId);
    const memberBindings = bindings.filter((binding) => binding.userId === parsed.userId);
    if (memberBindings.length === 0) {
      throw new TeamMembershipNotFoundError(parsed.userId);
    }
    const administratorsBefore = await this.effectiveAdminUserIds({
      organizationId: parsed.organizationId,
      bindings,
    });
    if (administratorsBefore.size === 0) {
      throw new TeamLastAdminRequiredError(team.name);
    }
    const administratorsAfter = await this.effectiveAdminUserIds({
      organizationId: parsed.organizationId,
      bindings: bindings.filter((binding) => binding.userId !== parsed.userId),
    });
    if (administratorsAfter.size === 0) {
      if (parsed.actor.type === "user" && parsed.actor.id === parsed.userId) {
        throw new CannotRemoveSelfAsLastAdminError(team.name);
      }
      throw new TeamLastAdminRequiredError(team.name);
    }
    await this.teams.fenceMembershipChange({
      teamId: team.id,
      organizationId: team.organizationId,
      expectedUpdatedAt: team.updatedAt,
      removeLegacyUserId: parsed.userId,
    });
    await this.grants.revokeBindings({
      organizationId: parsed.organizationId,
      bindingIds: memberBindings.map(({ id }) => id),
      actor: parsed.actor,
      reason: "removed from team",
    });
  }

  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamByIdInputSchema.parse(input);
    return this.teams.getById(parsed.teamId);
  }

  async getTeamBySlugForMember(
    input: GetOrganizationTeamBySlugForMemberInput,
  ): Promise<OrganizationTeam> {
    const parsed = getOrganizationTeamBySlugForMemberInputSchema.parse(input);
    const team = await this.teams.getBySlug(parsed);
    const bindings = await this.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: [team.id],
    });
    if (!(bindings.get(team.id) ?? []).some(({ userId }) => userId === parsed.userId)) {
      throw new TeamNotFoundError(team.id);
    }
    return team;
  }

  async getTeamWithMembers(
    input: GetOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeamWithMembers> {
    const parsed = getOrganizationTeamWithMembersInputSchema.parse(input);
    const team = await this.teams.getBySlug(parsed);
    if (!parsed.callerCanManage && team.isPersonal && team.ownerUserId !== parsed.callerUserId) {
      throw new TeamNotFoundError(team.id);
    }
    const bindings = await this.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: [team.id],
    });
    return {
      ...team,
      members: this.shapeTeamMembers({
        teamId: team.id,
        bindings: bindings.get(team.id) ?? [],
        visibleEmailUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
      }),
    };
  }

  async listTeamsWithMembers(
    input: ListOrganizationTeamsWithMembersInput,
  ): Promise<OrganizationTeamWithMembers[]> {
    const parsed = listOrganizationTeamsWithMembersInputSchema.parse(input);
    const teams = await this.teams.listActive({
      organizationId: parsed.organizationId,
      visibleToUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
    });
    const bindings = await this.authz.listTeamMemberBindings({
      organizationId: parsed.organizationId,
      teamIds: teams.map(({ id }) => id),
    });
    return teams.map((team) => ({
      ...team,
      members: this.shapeTeamMembers({
        teamId: team.id,
        bindings: bindings.get(team.id) ?? [],
        visibleEmailUserId: parsed.callerCanManage ? undefined : parsed.callerUserId,
      }),
    }));
  }

  async createTeamWithMembers(
    input: CreateOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeam> {
    const parsed = createOrganizationTeamWithMembersInputSchema.parse(input);
    await this.validateTeamMembers(parsed.organizationId, parsed.members);
    if (!parsed.members.some((member) => memberTarget(member).role === "ADMIN")) {
      throw new TeamLastAdminRequiredError(parsed.name);
    }
    const team = await this.createTeam({
      organizationId: parsed.organizationId,
      name: parsed.name,
    });
    await this.attachTeamMembers({
      organizationId: parsed.organizationId,
      teamId: team.id,
      members: parsed.members,
      actor: parsed.actor,
    });
    return team;
  }

  async updateTeamWithMembers(input: UpdateOrganizationTeamWithMembersInput): Promise<void> {
    const parsed = updateOrganizationTeamWithMembersInputSchema.parse(input);
    const team = await this.teams.getById(parsed.teamId);
    if (team.isPersonal) {
      const keepsOwner =
        parsed.members.length === 0 ||
        (parsed.members.length === 1 &&
          parsed.members[0]!.userId === team.ownerUserId &&
          memberTarget(parsed.members[0]!).role === "ADMIN");
      if (!keepsOwner) {
        throw new PersonalWorkspaceNotManagedHereError(team.name);
      }
    }
    await this.validateTeamMembers(team.organizationId, parsed.members);
    if (parsed.members.length === 0) {
      await this.teams.update({
        organizationId: team.organizationId,
        teamId: team.id,
        name: parsed.name,
      });
      return;
    }
    const bindings = await this.teamBindings(team.organizationId, team.id);
    const directBindings = bindings.filter(({ userId }) => userId !== null);
    const plan = planTeamMembership(directBindings, parsed.members);
    const administratorsAfter = await this.effectiveAdminUserIds({
      organizationId: team.organizationId,
      bindings,
      directAdminUserIds: directAdminIdsAfterPlan(directBindings, plan),
    });
    const administratorsBefore = await this.effectiveAdminUserIds({
      organizationId: team.organizationId,
      bindings,
    });
    if (administratorsBefore.size > 0 && administratorsAfter.size === 0) {
      throw new TeamLastAdminRequiredError(team.name);
    }
    await this.teams.fenceMembershipChange({
      teamId: team.id,
      organizationId: team.organizationId,
      expectedUpdatedAt: team.updatedAt,
      name: parsed.name,
    });
    await this.emitTeamMembershipPlan({
      organizationId: team.organizationId,
      teamId: team.id,
      actor: parsed.actor,
      plan,
    });
  }

  async listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]> {
    const parsed = listOrganizationTeamAccessInputSchema.parse(input);
    const teams = await this.teams.listActive({
      organizationId: parsed.organizationId,
    });
    const teamIds = teams.map(({ id }) => id);
    const projectIds = parsed.projects.map(({ id }) => id);
    const [teamBindings, projectBindings] = await Promise.all([
      this.authz.listScopeBindings({
        organizationId: parsed.organizationId,
        scopeType: "TEAM",
        scopeIds: teamIds,
      }),
      projectIds.length === 0
        ? Promise.resolve([])
        : this.authz.listScopeBindings({
            organizationId: parsed.organizationId,
            scopeType: "PROJECT",
            scopeIds: projectIds,
          }),
    ]);
    const allBindings = [...teamBindings, ...projectBindings];
    const groupIds = [
      ...new Set(allBindings.flatMap((binding) => (binding.groupId ? [binding.groupId] : []))),
    ];
    const groupMembers = await this.groups.listMembersForGroups({
      organizationId: parsed.organizationId,
      groupIds,
    });
    return teams.map((team) =>
      this.teamAccess({
        team,
        projects: parsed.projects.filter(({ teamId }) => teamId === team.id),
        teamBindings: teamBindings.filter(({ scopeId }) => scopeId === team.id),
        projectBindings,
        groupMembers,
      }),
    );
  }

  private teamBindings(organizationId: string, teamId: string): Promise<AuthzAccessBinding[]> {
    return this.authz.listScopeBindings({
      organizationId,
      scopeType: "TEAM",
      scopeIds: [teamId],
    });
  }

  private async effectiveAdminUserIds(input: {
    organizationId: string;
    bindings: AuthzAccessBinding[];
    directAdminUserIds?: Iterable<string>;
  }): Promise<Set<string>> {
    const administrators = new Set(
      input.directAdminUserIds ??
        input.bindings.flatMap((binding) =>
          binding.role === "ADMIN" && binding.userId ? [binding.userId] : [],
        ),
    );
    const adminGroupIds = input.bindings.flatMap((binding) =>
      binding.role === "ADMIN" && binding.groupId ? [binding.groupId] : [],
    );
    const members = await this.groups.listMembersForGroups({
      organizationId: input.organizationId,
      groupIds: [...new Set(adminGroupIds)],
    });
    for (const groupMembers of members.values()) {
      for (const member of groupMembers) administrators.add(member.userId);
    }
    return administrators;
  }

  private shapeTeamMembers(input: {
    teamId: string;
    bindings: AuthzTeamMemberBinding[];
    visibleEmailUserId?: string;
  }): OrganizationTeamMember[] {
    const displayedByUser = new Map<string, AuthzTeamMemberBinding>();
    for (const binding of input.bindings) {
      const displayed = displayedByUser.get(binding.userId);
      if (!displayed || TEAM_ROLE_PRIORITY[binding.role] < TEAM_ROLE_PRIORITY[displayed.role]) {
        displayedByUser.set(binding.userId, binding);
      }
    }
    return [...displayedByUser.values()]
      .map((binding) => ({
        userId: binding.userId,
        teamId: input.teamId,
        role: binding.role,
        assignedRoleId: binding.customRoleId,
        assignedRole: binding.customRole,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
        user: {
          id: binding.user.id,
          name: binding.user.name,
          email:
            input.visibleEmailUserId === undefined || input.visibleEmailUserId === binding.userId
              ? binding.user.email
              : null,
          image: binding.user.image,
        },
      }))
      .sort((left, right) => {
        const byName = compareNullableText(left.user.name, right.user.name);
        if (byName !== 0) return byName;
        const byEmail = compareNullableText(left.user.email, right.user.email);
        return byEmail !== 0 ? byEmail : left.userId.localeCompare(right.userId);
      });
  }

  private async validateTeamMembers(
    organizationId: string,
    members: OrganizationTeamMemberInput[],
  ): Promise<void> {
    await this.teams.getOrganizationMembers({
      organizationId,
      userIds: [...new Set(members.map(({ userId }) => userId))],
    });
    const customMembers = members.filter(({ role }) => role.startsWith("custom:"));
    if (customMembers.length === 0) return;
    const roles = await this.authz.listUserCreatedRoles({ organizationId });
    const assignable = new Set(roles.map(({ id }) => id));
    for (const member of customMembers) {
      if (!member.customRoleId) throw new TeamCustomRoleRequiredError();
      if (!assignable.has(member.customRoleId)) {
        throw new TeamCustomRoleNotAssignableError(member.customRoleId);
      }
    }
  }

  private attachTeamMembers(input: {
    organizationId: string;
    teamId: string;
    members: OrganizationTeamMemberInput[];
    actor: OrganizationLedgerActor;
  }): Promise<unknown> {
    return this.grants.attachBindings({
      organizationId: input.organizationId,
      bindings: input.members.map((member) => ({
        bindingId: this.teamIdentities.createBindingId(),
        principal: { userId: member.userId },
        ...memberTarget(member),
        scopeType: "TEAM" as const,
        scopeId: input.teamId,
      })),
      actor: input.actor,
      onDuplicate: "skip",
    });
  }

  private async emitTeamMembershipPlan(input: {
    organizationId: string;
    teamId: string;
    actor: OrganizationLedgerActor;
    plan: TeamMembershipPlan;
  }): Promise<void> {
    if (input.plan.membersToAdd.length > 0) {
      await this.attachTeamMembers({
        organizationId: input.organizationId,
        teamId: input.teamId,
        members: input.plan.membersToAdd,
        actor: input.actor,
      });
    }
    for (const binding of input.plan.bindingsToChange) {
      await this.grants.changeBindingRole({
        organizationId: input.organizationId,
        bindingId: binding.bindingId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        actor: input.actor,
      });
    }
    if (input.plan.bindingIdsToRemove.length > 0) {
      await this.grants.revokeBindings({
        organizationId: input.organizationId,
        bindingIds: input.plan.bindingIdsToRemove,
        actor: input.actor,
        reason: "removed from team",
      });
    }
  }

  private teamAccess(input: {
    team: OrganizationTeam;
    projects: OrganizationTeamAccessProject[];
    teamBindings: AuthzAccessBinding[];
    projectBindings: AuthzAccessBinding[];
    groupMembers: Map<string, OrganizationGroupMember[]>;
  }): OrganizationTeamAccess {
    const projectIds = new Set(input.projects.map(({ id }) => id));
    const projectBindings = input.projectBindings.filter(({ scopeId }) => projectIds.has(scopeId));
    const groupBindings = input.teamBindings.filter(({ groupId }) => groupId);
    const directUserBindings = input.teamBindings.filter(({ userId }) => userId);
    const directUserIds = new Set(
      directUserBindings.flatMap(({ userId }) => (userId ? [userId] : [])),
    );
    const seenExpandedUserIds = new Set<string>();
    const expandedGroupMembers = [...groupBindings]
      .sort((left, right) => TEAM_ROLE_PRIORITY[left.role] - TEAM_ROLE_PRIORITY[right.role])
      .flatMap((binding): OrganizationTeamAccessMember[] => {
        if (!binding.groupId) return [];
        return (input.groupMembers.get(binding.groupId) ?? []).flatMap((member) => {
          if (directUserIds.has(member.userId) || seenExpandedUserIds.has(member.userId)) {
            return [];
          }
          seenExpandedUserIds.add(member.userId);
          return [
            {
              bindingId: null,
              userId: member.userId,
              groupId: binding.groupId,
              viaGroupId: binding.groupId,
              viaGroupName: binding.group?.name ?? null,
              name: member.name ?? member.email ?? "Unknown",
              email: member.email,
              image: member.image,
              role: binding.role,
              customRoleId: binding.customRoleId,
              customRoleName: binding.customRole?.name ?? null,
            },
          ];
        });
      });
    const directMembers: OrganizationTeamAccessMember[] = [
      ...directUserBindings.map((binding) => ({
        bindingId: binding.id,
        userId: binding.userId,
        groupId: null,
        viaGroupId: null,
        viaGroupName: null,
        name: binding.user?.name ?? binding.user?.email ?? binding.apiKey?.name ?? "Unknown",
        email: binding.user?.email ?? null,
        image: binding.user?.image ?? null,
        role: binding.role,
        customRoleId: binding.customRoleId,
        customRoleName: binding.customRole?.name ?? null,
      })),
      ...expandedGroupMembers,
    ].sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      const byEmail = (left.email ?? "").localeCompare(right.email ?? "");
      return byEmail !== 0 ? byEmail : (left.userId ?? "").localeCompare(right.userId ?? "");
    });
    const teamBoundUserIds = new Set(
      directMembers.flatMap(({ userId }) => (userId ? [userId] : [])),
    );
    const projectOnlyAccess = new Map<
      string,
      OrganizationTeamAccess["projectOnlyAccess"][number]
    >();
    for (const binding of projectBindings) {
      if (!binding.userId || teamBoundUserIds.has(binding.userId)) continue;
      const project = input.projects.find(({ id }) => id === binding.scopeId);
      if (!project) continue;
      const key = `${binding.userId}:${project.id}`;
      if (!projectOnlyAccess.has(key)) {
        projectOnlyAccess.set(key, {
          bindingId: binding.id,
          userId: binding.userId,
          name: binding.user?.name ?? binding.userId,
          email: binding.user?.email ?? null,
          image: binding.user?.image ?? null,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }
    const projectAccess: OrganizationTeamAccess["projectAccess"] = {};
    const teamBoundGroupIds = new Set(
      groupBindings.flatMap(({ groupId }) => (groupId ? [groupId] : [])),
    );
    for (const project of input.projects) {
      const bindings = projectBindings.filter(({ scopeId }) => scopeId === project.id);
      const overriddenUserIds = new Set(bindings.flatMap(({ userId }) => (userId ? [userId] : [])));
      for (const binding of bindings) {
        if (!binding.groupId) continue;
        for (const member of input.groupMembers.get(binding.groupId) ?? []) {
          overriddenUserIds.add(member.userId);
        }
      }
      const inherited = directMembers
        .filter(({ userId }) => !userId || !overriddenUserIds.has(userId))
        .map(({ viaGroupId: _viaGroupId, ...member }) => ({
          ...member,
          source: "team" as const,
        }));
      const direct = bindings.map((binding) => {
        const teamBinding = input.teamBindings.find(
          (candidate) => candidate.userId && candidate.userId === binding.userId,
        );
        const inherits =
          (!!binding.userId && teamBoundUserIds.has(binding.userId)) ||
          (!!binding.groupId && teamBoundGroupIds.has(binding.groupId));
        return {
          bindingId: binding.id,
          userId: binding.userId,
          groupId: binding.groupId,
          viaGroupName: binding.groupId ? (binding.group?.name ?? null) : null,
          name: binding.user?.name ?? binding.group?.name ?? binding.apiKey?.name ?? "Unknown",
          email: binding.user?.email ?? null,
          image: binding.user?.image ?? null,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
          source: inherits ? ("override" as const) : ("direct" as const),
          ...(teamBinding ? { teamRole: teamBinding.role } : {}),
        };
      });
      projectAccess[project.id] = [...inherited, ...direct];
    }
    return {
      id: input.team.id,
      name: input.team.name,
      slug: input.team.slug,
      projects: input.projects,
      directMembers,
      projectOnlyAccess: [...projectOnlyAccess.values()],
      projectAccess,
    };
  }

  async getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    const [group, members, bindings] = await Promise.all([
      this.groups.get(parsed),
      this.groups.listMembers(parsed),
      this.readGroupBindings(parsed),
    ]);
    return { ...group, members, bindings };
  }

  async listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    const parsed = listOrganizationGroupsInputSchema.parse(input);
    const [page, bindings] = await Promise.all([
      this.groups.list(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.groupBindingsByGroup(bindings);
    return {
      ...page,
      data: page.data.map((group) => ({
        ...group,
        bindings: bindingsByGroup.get(group.id) ?? [],
      })),
    };
  }

  async listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    const parsed = listMemberOrganizationGroupsInputSchema.parse(input);
    const [groups, bindings] = await Promise.all([
      this.groups.listForMember(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.groupBindingsByGroup(bindings);
    return groups.map((group) => ({
      ...group,
      bindings: bindingsByGroup.get(group.id) ?? [],
    }));
  }

  async createGroup(input: CreateOrganizationGroupInput): Promise<OrganizationGroup> {
    const parsed = createOrganizationGroupInputSchema.parse(input);
    const memberIds = [...new Set(parsed.memberIds ?? [])];
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: memberIds,
    });
    const bindings = parsed.bindings ?? [];
    await this.validateGroupBindings(parsed.organizationId, bindings);
    const baseSlug = this.groupIdentities.slugify(parsed.name);
    const slug = await this.groups.nextAvailableSlug({
      organizationId: parsed.organizationId,
      baseSlug,
    });
    const group = await this.groups.create({
      groupId: this.groupIdentities.createGroupId(),
      organizationId: parsed.organizationId,
      name: parsed.name,
      slug,
      memberIds,
    });
    if (bindings.length > 0) {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: bindings.map((binding) => this.groupBindingWrite(group.id, binding)),
        actor: parsed.actor,
        onDuplicate: "skip",
      });
    }
    return group;
  }

  async renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup> {
    const parsed = renameOrganizationGroupInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) throw new ScimManagedGroupError(group.id);
    const slug = await this.groups.nextAvailableSlug({
      organizationId: parsed.organizationId,
      baseSlug: this.groupIdentities.slugify(parsed.name),
      excludeGroupId: parsed.groupId,
    });
    return this.groups.rename({ ...parsed, slug });
  }

  async deleteGroup(input: DeleteOrganizationGroupInput): Promise<void> {
    const parsed = deleteOrganizationGroupInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource && !parsed.allowScimManaged) {
      throw new ScimManagedGroupError(group.id);
    }
    await this.grants.revokeBindingsWhere({
      organizationId: parsed.organizationId,
      where: { groupId: parsed.groupId },
      actor: parsed.actor,
      reason: "group deleted",
    });
    await this.groups.delete(parsed);
  }

  async addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    const parsed = changeOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) throw new ScimManagedGroupError(group.id);
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: [parsed.userId],
    });
    await this.groups.addMember(parsed);
  }

  async removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    const parsed = changeOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) throw new ScimManagedGroupError(group.id);
    await this.groups.removeMember(parsed);
  }

  async listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupBinding[]> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    await this.groups.get(parsed);
    return this.readGroupBindings(parsed);
  }

  async addGroupBinding(
    input: AddOrganizationGroupBindingInput,
  ): Promise<OrganizationGroupBinding> {
    const parsed = addOrganizationGroupBindingInputSchema.parse(input);
    await this.groups.get(parsed);
    await this.validateGroupBindings(parsed.organizationId, [parsed.binding]);
    const write = this.groupBindingWrite(parsed.groupId, parsed.binding);
    try {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: [write],
        actor: parsed.actor,
        onDuplicate: "reject",
      });
    } catch (error) {
      if (
        error instanceof DuplicateBindingError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "role_binding_already_exists")
      ) {
        throw new GroupBindingAlreadyExistsError();
      }
      throw error;
    }
    return {
      id: write.bindingId,
      role: write.role,
      customRoleId: write.customRoleId,
      customRoleName: null,
      scopeType: write.scopeType,
      scopeId: write.scopeId,
    };
  }

  async removeGroupBinding(input: RemoveOrganizationGroupBindingInput): Promise<void> {
    const parsed = removeOrganizationGroupBindingInputSchema.parse(input);
    const rawBindings = parsed.groupId
      ? await this.authz.listGroupBindings({
          organizationId: parsed.organizationId,
          groupId: parsed.groupId,
        })
      : await this.authz.listOrganizationBindings({
          organizationId: parsed.organizationId,
        });
    const rawBinding = rawBindings.find(
      ({ id, groupId }) =>
        id === parsed.bindingId &&
        groupId !== null &&
        (parsed.groupId === undefined || groupId === parsed.groupId),
    );
    if (!rawBinding?.groupId) {
      throw new GroupBindingNotFoundError(parsed.bindingId);
    }
    await this.groups.get({
      organizationId: parsed.organizationId,
      groupId: rawBinding.groupId,
    });
    const binding = this.toGroupBinding(rawBinding);
    await this.assertGroupScopes(parsed.organizationId, [binding]);
    await this.grants.revokeBindings({
      organizationId: parsed.organizationId,
      bindingIds: [parsed.bindingId],
      actor: parsed.actor,
      reason: "group binding removed",
    });
  }

  async applyGroupEdits(input: ApplyOrganizationGroupEditsInput): Promise<void> {
    const parsed = applyOrganizationGroupEditsInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (
      group.scimSource &&
      (parsed.rename ||
        parsed.memberUserIdsToAdd.length > 0 ||
        parsed.memberUserIdsToRemove.length > 0)
    ) {
      throw new ScimManagedGroupError(group.id);
    }
    const memberIdsToAdd = [...new Set(parsed.memberUserIdsToAdd)];
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: memberIdsToAdd,
    });
    await this.validateGroupBindings(parsed.organizationId, parsed.bindingsToCreate);
    const currentBindings = await this.readGroupBindings(parsed);
    const deletedIds = new Set(parsed.bindingIdsToDelete);
    const bindingsToDelete = currentBindings.filter(({ id }) => deletedIds.has(id));
    await this.assertGroupScopes(parsed.organizationId, bindingsToDelete);
    if (bindingsToDelete.length > 0) {
      await this.grants.revokeBindings({
        organizationId: parsed.organizationId,
        bindingIds: bindingsToDelete.map(({ id }) => id),
        actor: parsed.actor,
      });
    }
    const rename = parsed.rename
      ? {
          name: parsed.rename.name,
          slug: await this.groups.nextAvailableSlug({
            organizationId: parsed.organizationId,
            baseSlug: this.groupIdentities.slugify(parsed.rename.name),
            excludeGroupId: parsed.groupId,
          }),
        }
      : parsed.rename;
    await this.groups.applyEdits({
      groupId: parsed.groupId,
      organizationId: parsed.organizationId,
      rename,
      memberUserIdsToAdd: memberIdsToAdd,
      memberUserIdsToRemove: [...new Set(parsed.memberUserIdsToRemove)],
    });
    if (parsed.bindingsToCreate.length > 0) {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: parsed.bindingsToCreate.map((binding) =>
          this.groupBindingWrite(parsed.groupId, binding),
        ),
        actor: parsed.actor,
        onDuplicate: "skip",
      });
    }
  }

  private async validateGroupBindings(
    organizationId: string,
    bindings: OrganizationGroupBindingInput[],
  ): Promise<void> {
    const customBindings = bindings.filter(({ role }) => role === "CUSTOM");
    if (customBindings.some(({ customRoleId }) => !customRoleId)) {
      throw new GroupCustomRoleRequiredError();
    }
    const customRoleIds = [
      ...new Set(customBindings.map(({ customRoleId }) => customRoleId as string)),
    ];
    const roles =
      customRoleIds.length === 0 ? [] : await this.authz.listUserCreatedRoles({ organizationId });
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const missingRole = customRoleIds.find((id) => !rolesById.has(id));
    if (missingRole) throw new GroupRoleNotAssignableError(missingRole);
    for (const binding of customBindings) {
      const role = rolesById.get(binding.customRoleId as string);
      const permissions = Array.isArray(role?.permissions)
        ? role.permissions.filter(
            (permission): permission is string => typeof permission === "string",
          )
        : [];
      const refused = permissions.find(
        (permission) =>
          !bindingScopeCanGrantPermission({
            scopeType: binding.scopeType,
            permission,
          }),
      );
      if (refused) throw new GroupRoleScopeError(refused, binding.scopeType);
    }
    await this.assertGroupScopes(organizationId, bindings);
  }

  private async assertGroupScopes(
    organizationId: string,
    bindings: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>,
  ): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.authz.tryResolveScope(
        binding.scopeType === "ORGANIZATION"
          ? { organizationId: binding.scopeId }
          : binding.scopeType === "TEAM"
            ? { teamId: binding.scopeId }
            : { projectId: binding.scopeId },
      );
      const resolvedOrganizationId =
        scope?.type === "organization" ? scope.id : scope?.organizationId;
      if (!scope || resolvedOrganizationId !== organizationId) {
        throw new GroupScopeNotInOrganizationError(binding.scopeType);
      }
      if (scope.type === "team" || scope.type === "project") {
        const team = await this.teams.get({
          organizationId,
          teamId: scope.type === "team" ? scope.id : scope.teamId,
        });
        if (team.isPersonal) {
          throw new PersonalWorkspaceNotManagedHereError();
        }
      }
    }
  }

  private groupBindingWrite(groupId: string, binding: OrganizationGroupBindingInput) {
    return {
      bindingId: this.groupIdentities.createBindingId(),
      principal: { groupId },
      role: binding.role,
      customRoleId: binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    };
  }

  private async readGroupBindings(input: {
    organizationId: string;
    groupId: string;
  }): Promise<OrganizationGroupBinding[]> {
    const bindings = await this.authz.listGroupBindings({
      organizationId: input.organizationId,
      groupId: input.groupId,
    });
    return bindings.map((binding) => this.toGroupBinding(binding));
  }

  private toGroupBinding(binding: {
    id: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
    customRole: { name: string } | null;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }): OrganizationGroupBinding {
    return {
      id: binding.id,
      role: binding.role,
      customRoleId: binding.customRoleId,
      customRoleName: binding.customRole?.name ?? null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    };
  }

  private groupBindingsByGroup(
    bindings: Array<{
      id: string;
      groupId: string | null;
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId: string | null;
      customRole: { name: string } | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>,
  ): Map<string, OrganizationGroupBinding[]> {
    const result = new Map<string, OrganizationGroupBinding[]>();
    for (const binding of bindings) {
      if (!binding.groupId) continue;
      const groupBindings = result.get(binding.groupId) ?? [];
      groupBindings.push(this.toGroupBinding(binding));
      result.set(binding.groupId, groupBindings);
    }
    return result;
  }

  private async setPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
    next: PersonalFeatures,
    action: string,
  ): Promise<PersonalFeatures> {
    const project = await this.getOwnedPersonalWorkspaceProject(input);
    await this.repository.setPersonalWorkspaceFeaturesWithAudit({
      projectId: project.id,
      callerUserId: input.callerUserId,
      organizationId: project.organizationId,
      action,
      before: readPersonalFeatures(project.personalFeatures),
      after: next,
    });
    return next;
  }

  private async getOwnedPersonalWorkspaceProject(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalWorkspaceFeatureProject> {
    const parsed = personalWorkspaceFeaturesInputSchema.parse(input);
    const project = await this.repository.getPersonalWorkspaceFeatureProject(parsed.projectId);
    if (!project.isPersonal || project.ownerUserId !== parsed.callerUserId) {
      throw new PersonalProjectOwnerMismatchError();
    }
    return project;
  }
}
