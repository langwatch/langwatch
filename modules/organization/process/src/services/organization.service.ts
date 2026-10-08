import type { AuthzApi } from "@langwatch/authz-contract";
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import {
  type OrganizationJoinSetting,
  UserNotInOrganizationError,
  getOldestTeamInputSchema,
  getOrganizationBillingProfileInputSchema,
  getOrganizationIdByTeamIdInputSchema,
  getOrganizationMembersInputSchema,
  type AddOrganizationTeamMemberInput,
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
  type OrganizationWithAdministrators,
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
  type OrganizationIdPage,
  type OrganizationIdPageInput,
  type OrganizationUsageCount,
  OrganizationNotFoundForTeamError,
  type PricingModel,
  type OrganizationCurrency,
  type SignInSecurityPolicy,
} from "@langwatch/organization-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { GroupRepository } from "../repositories/group.repository.ts";
import type {
  OrganizationRepository,
  OrganizationTeamProject,
} from "../repositories/organization.repository.ts";
import type { TeamRepository } from "../repositories/team.repository.ts";
import type { GroupIdentity } from "./group-identity.service.ts";
import { OrganizationGroupService } from "./organization-group.service.ts";
import {
  OrganizationSettingsService,
  type OrganizationSettingsNotices,
} from "./organization-settings.service.ts";
import { OrganizationTeamAccessService } from "./organization-team-access.service.ts";
import { OrganizationTeamMembersService } from "./organization-team-members.service.ts";
import { OrganizationTeamService } from "./organization-team.service.ts";
import type { PersonalWorkspaceDiagnostics } from "./personal-workspace-diagnostics.service.ts";
import type { PersonalWorkspaceIdentity } from "./personal-workspace-identity.service.ts";
import {
  PersonalWorkspaceService,
  type PersonalWorkspaceNotices,
} from "./personal-workspace.service.ts";
import type { TeamIdentity } from "./team-identity.service.ts";

export type { OrganizationSettingsNotices };

/** What the organization service is built from. */
export type OrganizationServiceDependencies = {
  repository: OrganizationRepository;
  teams: TeamRepository;
  groups: GroupRepository;
  identities: PersonalWorkspaceIdentity;
  teamIdentities: TeamIdentity;
  groupIdentities: GroupIdentity;
  authz: AuthzApi;
  grants: AuthzApi;
  diagnostics?: PersonalWorkspaceDiagnostics;
  /** Where a newly created personal workspace is recorded, so project records its project. */
  notices?: PersonalWorkspaceNotices;
  /** Where a changed presence switch is recorded, so presence folds it. */
  settingsNotices?: OrganizationSettingsNotices;
};

export class OrganizationService {
  private readonly repository: OrganizationRepository;
  private readonly teams: TeamRepository;

  private constructor(options: OrganizationServiceDependencies) {
    this.repository = options.repository;
    this.teams = options.teams;
    this.groupService = OrganizationGroupService.create(options);
    this.teamAccess = OrganizationTeamAccessService.create(options);
    this.teamMembers = OrganizationTeamMembersService.create({
      ...options,
      createTeam: (input) => this.createTeam(input),
    });
    this.teamService = OrganizationTeamService.create(options);
    this.settingsService = OrganizationSettingsService.create(options);
    this.personalWorkspaces = PersonalWorkspaceService.create({
      ...options,
      diagnostics: options.diagnostics,
      notices: options.notices,
    });
  }

  private readonly groupService: OrganizationGroupService;

  private readonly teamAccess: OrganizationTeamAccessService;

  private readonly teamMembers: OrganizationTeamMembersService;

  private readonly personalWorkspaces: PersonalWorkspaceService;

  private readonly teamService: OrganizationTeamService;

  private readonly settingsService: OrganizationSettingsService;

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
  listAllIds(input?: OrganizationIdPageInput): Promise<OrganizationIdPage> {
    return this.repository.listAllIds(input);
  }

  /** Every project id under the organization's teams, archived included. */
  listProjectIds(organizationId: string): Promise<string[]> {
    return this.repository.findProjectIds(organizationId);
  }

  findProjectNames(projectIds: readonly string[]): Promise<{ id: string; name: string }[]> {
    return this.repository.findProjectNames(projectIds);
  }

  listProjects(input: {
    organizationId: string;
    teamId?: string;
    limit?: number;
  }): Promise<OrganizationTeamProject[]> {
    return this.repository.findProjects(input);
  }

  countUsage(input: { organizationIds: readonly string[] }): Promise<OrganizationUsageCount> {
    return this.repository.countUsage(input);
  }

  memberOrganizationIds(input: { userId: string; organizationIds: string[] }): Promise<string[]> {
    return this.teams.memberOrganizationIds(input);
  }

  /** Every organization this person belongs to, for a caller with no list of
   *  candidates to filter. */
  organizationIdsForMember(input: { userId: string }): Promise<string[]> {
    return this.teams.organizationIdsForMember(input);
  }

  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]> {
    return this.teams.getOrganizationMembers(getOrganizationMembersInputSchema.parse(input));
  }

  async getOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string> {
    const parsed = getOrganizationIdByTeamIdInputSchema.parse(input);
    const organizationId = await this.teams.findOrganizationId(parsed);
    if (organizationId === null) throw new OrganizationNotFoundForTeamError(parsed.teamId);
    return organizationId;
  }

  async getSettings(input: { organizationId: string }): Promise<OrganizationSettings> {
    return this.settingsService.getSettings(input);
  }
  /** How colleagues on a matching domain get in, where the organization keeps it. */
  getJoinSetting(input: { organizationId: string }): Promise<OrganizationJoinSetting> {
    return this.repository.getJoinSetting(input);
  }

  saveJoinSetting(input: {
    organizationId: string;
    setting: OrganizationJoinSetting;
  }): Promise<void> {
    return this.repository.saveJoinSetting(input);
  }

  findBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    return this.repository.findBySsoDomain(input);
  }

  getSessionPolicy(input: { organizationId: string }): Promise<{ maxSessionDurationDays: number }> {
    return this.repository.getSessionPolicy(input);
  }

  getSignInSecurityPolicy(input: { organizationId: string }): Promise<SignInSecurityPolicy> {
    return this.repository.getSignInSecurityPolicy(input);
  }

  updateSignInSecurityPolicy(input: {
    organizationId: string;
    policy: SignInSecurityPolicy;
  }): Promise<void> {
    return this.repository.updateSignInSecurityPolicy(input);
  }

  findSignInSecurityPoliciesForUser(input: { userId: string }): Promise<SignInSecurityPolicy[]> {
    return this.repository.findSignInSecurityPoliciesForUser(input);
  }

  findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]> {
    return this.repository.findConfiguredSignInSecurityPolicies();
  }

  saveSessionPolicy(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void> {
    return this.repository.saveSessionPolicy(input);
  }

  getPricing(input: {
    organizationId: string;
  }): Promise<{ pricingModel: PricingModel | null; currency: "USD" | "EUR" }> {
    return this.repository.getPricing(input);
  }

  getDatasetLimits(input: {
    organizationId: string;
  }): Promise<{ attachmentMaxBytes: number | null }> {
    return this.repository.getDatasetLimits(input);
  }

  isInstantEvalsOptedIn(input: { organizationId: string }): Promise<boolean> {
    return this.repository.isInstantEvalsOptedIn(input);
  }

  /** The moment that counts is the one the agreement was given, so it is taken here. */
  recordInstantEvalsOptIn(input: { organizationId: string; userId: string }): Promise<void> {
    return this.repository.recordInstantEvalsOptIn({ ...input, at: nowInstant() });
  }

  /** The guided-onboarding record, where the organization keeps it. */
  readGuidedOnboardingState(input: { organizationId: string }): Promise<GuidedOnboardingRecord> {
    return this.repository.getGuidedOnboarding(input);
  }

  writeGuidedOnboardingState(input: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord> {
    return this.repository.saveGuidedOnboarding(input);
  }

  async updateSettings(
    input: UpdateOrganizationSettingsInput,
    by: Readonly<{ id: string }> | null,
  ): Promise<UpdateOrganizationSettingsResult> {
    return this.settingsService.updateSettings(input, by);
  }
  /** The backfill's record of one organization's stored presence switch; keyed once per row. */
  async recordStoredPresenceSetting(input: { organizationId: string }): Promise<boolean> {
    return this.settingsService.recordStoredPresenceSetting(input);
  }

  static create(options: OrganizationServiceDependencies): OrganizationService {
    return new OrganizationService(options);
  }

  getOldestTeamId(input: GetOldestTeamInput): Promise<string> {
    const parsed = getOldestTeamInputSchema.parse(input);

    return this.repository.getOldestTeamId(parsed.organizationId);
  }

  getWithAdministrators(input: {
    organizationId: string;
  }): Promise<OrganizationWithAdministrators> {
    return this.repository.getWithAdministrators(input.organizationId);
  }

  updateSentPlanLimitAlert(input: { organizationId: string; sentAt: Instant }): Promise<void> {
    return this.repository.updateSentPlanLimitAlert(input);
  }

  /** Billing's checkout currency, applied from its fact (R42). */
  updateCurrency(input: { organizationId: string; currency: OrganizationCurrency }): Promise<void> {
    return this.repository.updateCurrency(input);
  }

  /** Billing's pricing model, applied from its fact (R42). */
  updatePricingModel(input: { organizationId: string; pricingModel: PricingModel }): Promise<void> {
    return this.repository.updatePricingModel(input);
  }

  setLicense(input: {
    organizationId: string;
    licenseKey: string;
    expiresAt: Instant;
    validatedAt: Instant | null;
  }): Promise<void> {
    return this.repository.setLicense(input);
  }

  clearLicense(input: { organizationId: string }): Promise<void> {
    return this.repository.clearLicense(input);
  }

  /** As `/me` read it: the configured contact, else the longest-seated enabled administrator. */
  async findSupportContact(input: { organizationId: string }): Promise<string | null> {
    return this.settingsService.findSupportContact(input);
  }

  getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile> {
    return this.repository.getBillingProfile(
      getOrganizationBillingProfileInputSchema.parse(input).organizationId,
    );
  }

  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    return this.personalWorkspaces.ensurePersonalWorkspace(input);
  }

  getPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace> {
    return this.personalWorkspaces.getPersonalWorkspace(input);
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
    return this.teamService.getTeam(input);
  }

  findPersonalTeamOwners(
    input: Readonly<{ organizationId: string; teamIds: readonly string[] }>,
  ): Promise<{ teamId: string; ownerUserId: string | null }[]> {
    return this.teamService.findPersonalTeamOwners(input);
  }

  listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage> {
    return this.teamService.listTeams(input);
  }

  async createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.teamService.createTeam(input);
  }

  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.teamService.updateTeam(input);
  }

  async archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.teamService.archiveTeam(input);
  }

  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    return this.teamMembers.addTeamMember(input);
  }

  removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void> {
    return this.teamMembers.removeTeamMember(input);
  }

  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    return this.teamService.getTeamById(input);
  }

  async getTeamBySlugForMember(
    input: GetOrganizationTeamBySlugForMemberInput,
  ): Promise<OrganizationTeam> {
    return this.teamService.getTeamBySlugForMember(input);
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

  async addGroupGrant(
    input: Parameters<OrganizationGroupService["addGroupGrant"]>[0],
  ): ReturnType<OrganizationGroupService["addGroupGrant"]> {
    return this.groupService.addGroupGrant(input);
  }

  async removeGroupGrant(
    input: Parameters<OrganizationGroupService["removeGroupGrant"]>[0],
  ): ReturnType<OrganizationGroupService["removeGroupGrant"]> {
    return this.groupService.removeGroupGrant(input);
  }

  async applyGroupEdits(
    input: Parameters<OrganizationGroupService["applyGroupEdits"]>[0],
  ): ReturnType<OrganizationGroupService["applyGroupEdits"]> {
    return this.groupService.applyGroupEdits(input);
  }
}
