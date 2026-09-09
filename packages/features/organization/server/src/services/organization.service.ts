import type { AuthzApi } from "@langwatch/authz-contract";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  OrganizationService as OrganizationServiceContract,
  OrganizationNotFoundError,
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PersonalTeamProtectedError,
  TeamNotFoundError,
  UserNotInOrganizationError,
  TeamSlugConflictError,
  claimOrganizationBillingCustomerInputSchema,
  createOrganizationTeamInputSchema,
  getOrganizationTeamInputSchema,
  getOrganizationTeamByIdInputSchema,
  getOrganizationTeamBySlugForMemberInputSchema,
  getOldestTeamInputSchema,
  getOrganizationBillingProfileInputSchema,
  getOrganizationIdByTeamIdInputSchema,
  getOrganizationMembersInputSchema,
  getOrganizationSettingsInputSchema,
  listOrganizationTeamsInputSchema,
  updateOrganizationTeamInputSchema,
  updateOrganizationSettingsInputSchema,
  type AddOrganizationTeamMemberInput,
  type ClaimOrganizationBillingCustomerInput,
  type CreateOrganizationTeamInput,
  type CreateOrganizationTeamWithMembersInput,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type GetOrganizationTeamWithMembersInput,
  type GetOldestTeamInput,
  type GetOrganizationBillingProfileInput,
  type GetOrganizationIdByTeamIdInput,
  type GetOrganizationMembersInput,
  type ListOrganizationTeamsInput,
  type ListOrganizationTeamsWithMembersInput,
  type ListOrganizationTeamAccessInput,
  type OrganizationBillingProfile,
  type OrganizationTeam,
  type OrganizationTeamAccess,
  type OrganizationTeamPage,
  type OrganizationTeamWithMembers,
  type OrganizationSettings,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceFeaturesInput,
  type PersonalWorkspaceInput,
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
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../ports/organization.port.ts";
import type { GroupRepository } from "../repositories/group.repository.ts";
import type { TeamRepository } from "../repositories/team.repository.ts";

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

import { OrganizationGroupService } from "./organization-group.service.ts";
import { OrganizationTeamAccessService } from "./organization-team-access.service.ts";
import { OrganizationTeamMembersService } from "./organization-team-members.service.ts";
import { PersonalWorkspaceService } from "./personal-workspace.service.ts";

export class OrganizationService extends OrganizationServiceContract {
  private constructor(
    private readonly repository: OrganizationRepository,
    private readonly teams: TeamRepository,
    private readonly groups: GroupRepository,
    private readonly identities: PersonalWorkspaceIdentityPort,
    private readonly teamIdentities: TeamIdentityPort,
    private readonly groupIdentities: GroupIdentityPort,
    private readonly authz: AuthzApi,
    private readonly grants: AuthzApi,
    private readonly diagnostics: PersonalWorkspaceDiagnosticsPort | undefined,
  ) {
    super();
    this.groupService = OrganizationGroupService.create({
      groups,
      groupIdentities,
      teams,
      authz,
      grants,
    });
    this.teamAccess = OrganizationTeamAccessService.create({ authz, groups, teams });
    this.teamMembers = OrganizationTeamMembersService.create({
      authz,
      grants,
      groups,
      teams,
      teamIdentities,
      createTeam: (input) => this.createTeam(input),
    });
    this.personalWorkspaces = PersonalWorkspaceService.create({
      repository,
      identities,
      grants,
      diagnostics,
    });
  }

  private readonly groupService: OrganizationGroupService;

  private readonly teamAccess: OrganizationTeamAccessService;

  private readonly teamMembers: OrganizationTeamMembersService;

  private readonly personalWorkspaces: PersonalWorkspaceService;

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
      if (error instanceof UserNotInOrganizationError) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Which of the named organizations this person belongs to, resolved in one
   * read rather than one per organization.
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
    if (!settings) {
      throw new OrganizationNotFoundError();
    }

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
    authz: AuthzApi;
    grants: AuthzApi;
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

  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    return this.personalWorkspaces.ensurePersonalWorkspace(input);
  }

  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.personalWorkspaces.tryFindPersonalWorkspace(input);
  }

  getPersonalWorkspaceFeatures(input: PersonalWorkspaceFeaturesInput): Promise<PersonalFeatures> {
    return this.personalWorkspaces.getPersonalWorkspaceFeatures(input);
  }

  enableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.personalWorkspaces.enableAllPersonalWorkspaceFeatures(input);
  }

  disableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures> {
    return this.personalWorkspaces.disableAllPersonalWorkspaceFeatures(input);
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
    if (duplicate) {
      throw new TeamSlugConflictError();
    }

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

  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    return this.teamMembers.addTeamMember(input);
  }

  removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void> {
    return this.teamMembers.removeTeamMember(input);
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

  getTeamWithMembers(
    input: GetOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeamWithMembers> {
    return this.teamMembers.getTeamWithMembers(input);
  }

  listTeamsWithMembers(
    input: ListOrganizationTeamsWithMembersInput,
  ): Promise<OrganizationTeamWithMembers[]> {
    return this.teamMembers.listTeamsWithMembers(input);
  }

  createTeamWithMembers(input: CreateOrganizationTeamWithMembersInput): Promise<OrganizationTeam> {
    return this.teamMembers.createTeamWithMembers(input);
  }

  updateTeamWithMembers(input: UpdateOrganizationTeamWithMembersInput): Promise<void> {
    return this.teamMembers.updateTeamWithMembers(input);
  }

  listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]> {
    return this.teamAccess.listTeamAccess(input);
  }

  async getGroup(
    input: Parameters<OrganizationGroupService["getGroup"]>[0],
  ): ReturnType<OrganizationGroupService["getGroup"]> {
    return this.groupService.getGroup(input);
  }

  async listGroups(
    input: Parameters<OrganizationGroupService["listGroups"]>[0],
  ): ReturnType<OrganizationGroupService["listGroups"]> {
    return this.groupService.listGroups(input);
  }

  async listGroupsForMember(
    input: Parameters<OrganizationGroupService["listGroupsForMember"]>[0],
  ): ReturnType<OrganizationGroupService["listGroupsForMember"]> {
    return this.groupService.listGroupsForMember(input);
  }

  async createGroup(
    input: Parameters<OrganizationGroupService["createGroup"]>[0],
  ): ReturnType<OrganizationGroupService["createGroup"]> {
    return this.groupService.createGroup(input);
  }

  async renameGroup(
    input: Parameters<OrganizationGroupService["renameGroup"]>[0],
  ): ReturnType<OrganizationGroupService["renameGroup"]> {
    return this.groupService.renameGroup(input);
  }

  async deleteGroup(
    input: Parameters<OrganizationGroupService["deleteGroup"]>[0],
  ): ReturnType<OrganizationGroupService["deleteGroup"]> {
    return this.groupService.deleteGroup(input);
  }

  async addGroupMember(
    input: Parameters<OrganizationGroupService["addGroupMember"]>[0],
  ): ReturnType<OrganizationGroupService["addGroupMember"]> {
    return this.groupService.addGroupMember(input);
  }

  async removeGroupMember(
    input: Parameters<OrganizationGroupService["removeGroupMember"]>[0],
  ): ReturnType<OrganizationGroupService["removeGroupMember"]> {
    return this.groupService.removeGroupMember(input);
  }

  async listGroupBindings(
    input: Parameters<OrganizationGroupService["listGroupBindings"]>[0],
  ): ReturnType<OrganizationGroupService["listGroupBindings"]> {
    return this.groupService.listGroupBindings(input);
  }

  async addGroupBinding(
    input: Parameters<OrganizationGroupService["addGroupBinding"]>[0],
  ): ReturnType<OrganizationGroupService["addGroupBinding"]> {
    return this.groupService.addGroupBinding(input);
  }

  async removeGroupBinding(
    input: Parameters<OrganizationGroupService["removeGroupBinding"]>[0],
  ): ReturnType<OrganizationGroupService["removeGroupBinding"]> {
    return this.groupService.removeGroupBinding(input);
  }

  async applyGroupEdits(
    input: Parameters<OrganizationGroupService["applyGroupEdits"]>[0],
  ): ReturnType<OrganizationGroupService["applyGroupEdits"]> {
    return this.groupService.applyGroupEdits(input);
  }
}
