import type {
  AddOrganizationGroupBindingInput,
  ApplyOrganizationGroupEditsInput,
  ChangeOrganizationGroupMemberInput,
  CreateOrganizationGroupInput,
  DeleteOrganizationGroupInput,
  GetOrganizationGroupInput,
  ListMemberOrganizationGroupsInput,
  ListOrganizationGroupsInput,
  OrganizationGroup,
  OrganizationGroupBinding,
  OrganizationGroupDetails,
  OrganizationGroupPage,
  OrganizationGroupSummary,
  RemoveOrganizationGroupBindingInput,
  RenameOrganizationGroupInput,
} from "./group";
import type {
  ClaimOrganizationBillingCustomerInput,
  GetOrganizationIdByTeamIdInput,
  GetOrganizationSettingsInput,
  GetOldestTeamInput,
  GetOrganizationBillingProfileInput,
  GetOrganizationMembersInput,
  OrganizationBillingProfile,
  OrganizationSettings,
  UpdateOrganizationSettingsInput,
  UpdateOrganizationSettingsResult,
} from "./organization";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceFeaturesInput,
  PersonalWorkspaceInput,
} from "./personal-workspace";
import type {
  AddOrganizationTeamMemberInput,
  CreateOrganizationTeamWithMembersInput,
  CreateOrganizationTeamInput,
  GetOrganizationTeamByIdInput,
  GetOrganizationTeamBySlugForMemberInput,
  GetOrganizationTeamWithMembersInput,
  GetOrganizationTeamInput,
  ListOrganizationTeamAccessInput,
  ListOrganizationTeamsWithMembersInput,
  ListOrganizationTeamsInput,
  OrganizationTeam,
  OrganizationTeamAccess,
  OrganizationTeamPage,
  OrganizationTeamWithMembers,
  RemoveOrganizationTeamMemberInput,
  UpdateOrganizationTeamWithMembersInput,
  UpdateOrganizationTeamInput,
} from "./team";

export abstract class OrganizationService {
  abstract getSettings(input: GetOrganizationSettingsInput): Promise<OrganizationSettings>;
  abstract updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult>;
  /** Returns the requested members or throws UserNotInOrganizationError. */
  abstract getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]>;
  /** Returns whether a user belongs to an organization. */
  abstract isMember(input: {
    organizationId: string;
    userId: string;
    includeDeactivated?: boolean;
  }): Promise<boolean>;
  /**
   * Which of the named organizations this person belongs to, in one read.
   *
   * Input order is kept and a non-membership is absent, so a caller can map
   * its own list without the answer becoming a membership oracle for the
   * organizations it is not in.
   */
  abstract memberOrganizationIds(input: {
    userId: string;
    organizationIds: string[];
  }): Promise<string[]>;
  /** Returns the oldest team or throws OrganizationHasNoTeamError. */
  abstract getOldestTeamId(input: GetOldestTeamInput): Promise<string>;

  /**
   * The organization that owns one team, or null when no such team exists.
   *
   * Absence is an answer rather than a refusal: usage metering and the
   * personal-workspace reads ask it about a team id they were handed by a
   * project row, and a team that has since gone means "no tenant to meter",
   * not "the lookup broke".
   */
  abstract tryGetOrganizationIdByTeamId(
    input: GetOrganizationIdByTeamIdInput,
  ): Promise<string | null>;

  /** Returns the billing-facing profile or throws OrganizationNotFoundError. */
  abstract getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile>;

  /** Atomically claims the empty billing-customer slot. */
  abstract claimBillingCustomerId(input: ClaimOrganizationBillingCustomerInput): Promise<boolean>;

  abstract ensurePersonalWorkspace(
    input: PersonalWorkspaceInput,
  ): Promise<EnsuredPersonalWorkspace>;
  abstract tryFindPersonalWorkspace(
    input: FindPersonalWorkspaceInput,
  ): Promise<PersonalWorkspace | null>;
  abstract getPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures>;
  abstract enableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures>;
  abstract disableAllPersonalWorkspaceFeatures(
    input: PersonalWorkspaceFeaturesInput,
  ): Promise<PersonalFeatures>;
  abstract getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
  abstract listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage>;
  abstract createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam>;
  abstract updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam>;
  abstract archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
  abstract addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void>;
  abstract removeTeamMember(input: RemoveOrganizationTeamMemberInput): Promise<void>;
  abstract getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam>;
  abstract getTeamBySlugForMember(
    input: GetOrganizationTeamBySlugForMemberInput,
  ): Promise<OrganizationTeam>;
  abstract getTeamWithMembers(
    input: GetOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeamWithMembers>;
  abstract listTeamsWithMembers(
    input: ListOrganizationTeamsWithMembersInput,
  ): Promise<OrganizationTeamWithMembers[]>;
  abstract createTeamWithMembers(
    input: CreateOrganizationTeamWithMembersInput,
  ): Promise<OrganizationTeam>;
  abstract updateTeamWithMembers(input: UpdateOrganizationTeamWithMembersInput): Promise<void>;
  abstract listTeamAccess(
    input: ListOrganizationTeamAccessInput,
  ): Promise<OrganizationTeamAccess[]>;

  abstract getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails>;
  abstract listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage>;
  abstract listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]>;
  abstract createGroup(input: CreateOrganizationGroupInput): Promise<OrganizationGroup>;
  abstract renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup>;
  abstract deleteGroup(input: DeleteOrganizationGroupInput): Promise<void>;
  abstract addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void>;
  abstract removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void>;
  abstract listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupBinding[]>;
  abstract addGroupBinding(
    input: AddOrganizationGroupBindingInput,
  ): Promise<OrganizationGroupBinding>;
  abstract removeGroupBinding(input: RemoveOrganizationGroupBindingInput): Promise<void>;
  abstract applyGroupEdits(input: ApplyOrganizationGroupEditsInput): Promise<void>;
}
