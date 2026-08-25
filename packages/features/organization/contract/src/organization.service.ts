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
  GetOldestTeamInput,
  GetOrganizationBillingProfileInput,
  OrganizationBillingProfile,
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
  /** Returns whether a user belongs to an organization. */
  abstract isMember(input: {
    organizationId: string;
    userId: string;
    includeDeactivated?: boolean;
  }): Promise<boolean>;
  /** Returns the oldest team or throws OrganizationHasNoTeamError. */
  abstract getOldestTeamId(input: GetOldestTeamInput): Promise<string>;

  /** Returns the billing-facing profile or throws OrganizationNotFoundError. */
  abstract getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile>;

  /** Atomically claims the empty billing-customer slot. */
  abstract claimBillingCustomerId(
    input: ClaimOrganizationBillingCustomerInput,
  ): Promise<boolean>;

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
  abstract listTeams(
    input: ListOrganizationTeamsInput,
  ): Promise<OrganizationTeamPage>;
  abstract createTeam(
    input: CreateOrganizationTeamInput,
  ): Promise<OrganizationTeam>;
  abstract updateTeam(
    input: UpdateOrganizationTeamInput,
  ): Promise<OrganizationTeam>;
  abstract archiveTeam(
    input: GetOrganizationTeamInput,
  ): Promise<OrganizationTeam>;
  abstract addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void>;
  abstract removeTeamMember(
    input: RemoveOrganizationTeamMemberInput,
  ): Promise<void>;
  abstract getTeamById(
    input: GetOrganizationTeamByIdInput,
  ): Promise<OrganizationTeam>;
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
  abstract updateTeamWithMembers(
    input: UpdateOrganizationTeamWithMembersInput,
  ): Promise<void>;
  abstract listTeamAccess(
    input: ListOrganizationTeamAccessInput,
  ): Promise<OrganizationTeamAccess[]>;

  abstract getGroup(
    input: GetOrganizationGroupInput,
  ): Promise<OrganizationGroupDetails>;
  abstract listGroups(
    input: ListOrganizationGroupsInput,
  ): Promise<OrganizationGroupPage>;
  abstract listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]>;
  abstract createGroup(
    input: CreateOrganizationGroupInput,
  ): Promise<OrganizationGroup>;
  abstract renameGroup(
    input: RenameOrganizationGroupInput,
  ): Promise<OrganizationGroup>;
  abstract deleteGroup(input: DeleteOrganizationGroupInput): Promise<void>;
  abstract addGroupMember(
    input: ChangeOrganizationGroupMemberInput,
  ): Promise<void>;
  abstract removeGroupMember(
    input: ChangeOrganizationGroupMemberInput,
  ): Promise<void>;
  abstract listGroupBindings(
    input: GetOrganizationGroupInput,
  ): Promise<OrganizationGroupBinding[]>;
  abstract addGroupBinding(
    input: AddOrganizationGroupBindingInput,
  ): Promise<OrganizationGroupBinding>;
  abstract removeGroupBinding(
    input: RemoveOrganizationGroupBindingInput,
  ): Promise<void>;
  abstract applyGroupEdits(
    input: ApplyOrganizationGroupEditsInput,
  ): Promise<void>;
}
