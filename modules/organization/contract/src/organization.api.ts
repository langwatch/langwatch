import { moduleApi } from "@langwatch/runtime-composition";
import type { AuthzAccessBreakdownOutput } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";
import type { PaginatedProjects, Project } from "@langwatch/project-contract";
import type {
  EnrichedAuditLog,
  GetOrganizationBillingProfileInput,
  GetOrganizationIdByTeamIdInput,
  GetOrganizationMembersInput,
  GetOldestTeamInput,
  OrganizationBillingProfile,
  OrganizationIntent,
  UpdateOrganizationSettingsInput,
  UpdateOrganizationSettingsResult,
} from "./organization.ts";
import type {
  AddOrganizationGroupBindingInput,
  ApplyOrganizationGroupEditsInput,
  ChangeOrganizationGroupMemberInput,
  CreateOrganizationGroupInput,
  DeleteOrganizationGroupInput,
  GetOrganizationGroupInput,
  OrganizationGroup,
  OrganizationGroupBinding,
  OrganizationGroupDetails,
  OrganizationGroupPage,
  OrganizationGroupSummary,
  ListMemberOrganizationGroupsInput,
  ListOrganizationGroupsInput,
  RenameOrganizationGroupInput,
  RemoveOrganizationGroupBindingInput,
} from "./group.ts";
import type {
  CreateOrganizationTeamWithMembersInput,
  CreateOrganizationTeamInput,
  AddOrganizationTeamMemberInput,
  GetOrganizationTeamByIdInput,
  GetOrganizationTeamBySlugForMemberInput,
  GetOrganizationTeamInput,
  GetOrganizationTeamWithMembersInput,
  ListOrganizationTeamAccessInput,
  ListOrganizationTeamsInput,
  ListOrganizationTeamsWithMembersInput,
  OrganizationTeam,
  OrganizationTeamPage,
  OrganizationTeamAccess,
  OrganizationTeamWithMembers,
  RemoveOrganizationTeamMemberInput,
  UpdateOrganizationTeamWithMembersInput,
} from "./team.ts";
import type {
  Organization,
  CustomRole,
  OrganizationUser,
  OrganizationUserRole,
  ProjectRow,
  Team,
  TeamUser,
  User,
} from "./organization.rows.ts";
import type {
  JoinRequestFiled,
  JoinRequestJoining,
  JoinRequestJoiningChanged,
  JoinRequestMine,
  JoinRequestPending,
} from "./join-request.responses.ts";
import type { OnboardingInitializeOrganizationInput } from "./onboarding.trpc.ts";
import type { OrganizationInitialized } from "./onboarding.responses.ts";
import type {
  OrganizationInviteAccepted,
  OrganizationInviteCreated,
  OrganizationInviteResent,
  OrganizationListedInvite,
} from "./organization.responses.ts";
import type {
  OrganizationApiCreateInvitesInput,
  OrganizationApiInviteScope,
  OrganizationApiUpdateTeamMemberRoleInput,
} from "./organization.trpc-schemas.ts";
import type { GroupDetail, GroupListItem, GroupMembershipView } from "./group.responses.ts";
import type { TeamWithProjects } from "./team.responses.ts";
import type {
  FindPersonalWorkspaceInput,
  EnsuredPersonalWorkspace,
  PersonalFeatures,
  PersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceFeaturesInput,
} from "./personal-workspace.ts";

export interface OrganizationCaller {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
}

export type OrganizationRestMemberSummary = Readonly<{
  userId: string;
  organizationId: string;
  role: string;
  disabledAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  user: { id: string; name: string | null; email: string | null };
}>;
export type OrganizationRestMemberTeamBinding = Readonly<{
  teamId: string;
  teamName: string;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
}>;
export type OrganizationProvisioningSummary = Readonly<{
  id: string;
  name: string;
  slug: string;
  createdAt: Instant;
}>;

type TeamWithProjectsAndMembers = Team & {
  projects: ProjectRow[];
  members: (TeamUser & { assignedRole?: CustomRole | null })[];
};

export type FullyLoadedOrganization = Organization & {
  members: OrganizationUser[];
  teams: TeamWithProjectsAndMembers[];
};

type TeamMemberWithTeam = TeamUser & {
  team: Team;
  assignedRole?: CustomRole | null;
};

type UserWithTeams = User & { teamMemberships: TeamMemberWithTeam[] };
type OrganizationMemberWithUser = OrganizationUser & { user: UserWithTeams };

export type OrganizationWithMembersAndTheirTeams = Organization & {
  members: OrganizationMemberWithUser[];
};

export interface OrganizationApi {
  createAndAssign(
    input: Readonly<{
      orgName?: string;
      phoneNumber?: string;
      signUpData?: Record<string, unknown>;
      primaryIntent?: OrganizationIntent | null;
      userDisplayName?: string | null;
    }>,
    by: OrganizationCaller,
  ): Promise<{
    organization: { id: string; name: string };
    team: { id: string; slug: string; name: string };
  }>;
  deleteMember(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller | null,
  ): Promise<void>;
  setMemberDisabled(
    input: Readonly<{ organizationId: string; userId: string; disabled: boolean }>,
    by: OrganizationCaller | null,
  ): Promise<void>;
  getAllForUser(
    input: Readonly<{ isDemo: boolean; demoProjectUserId: string; demoProjectId: string }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]>;
  updateSettings(input: UpdateOrganizationSettingsInput): Promise<UpdateOrganizationSettingsResult>;
  getSettings(input: {
    organizationId: string;
  }): Promise<import("./organization.ts").OrganizationSettings>;
  listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage>;
  listMembers(input: {
    organizationId: string;
    includeDisabled?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ members: OrganizationRestMemberSummary[]; totalCount: number }>;
  getMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRestMemberSummary & { teams: OrganizationRestMemberTeamBinding[] }>;
  createForProvisioning(input: { name: string; slug?: string }): Promise<{
    organization: { id: string; name: string };
    team: { id: string; slug: string; name: string };
  }>;
  listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]>;
  findProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null>;
  deleteProvisionedOrganization(input: { organizationId: string }): Promise<void>;
  /**
   * Provisions a new organization end to end: the organization and its first
   * team, a bootstrap admin service key, and the read-back summary. On
   * failure past organization creation it compensates by deleting the
   * organization, reporting a failed compensation rather than raising it over
   * the original error.
   */
  createForProvisioningWithAdminKey(input: {
    name: string;
    slug?: string;
    adminApiKeyName?: string;
  }): Promise<{
    organization: { id: string; name: string; slug: string };
    team: { id: string; slug: string; name: string };
    adminApiKey: { id: string; token: string };
  }>;
  /** The authorization feature's per-member access breakdown, organization's own door onto it. */
  getMemberAccessBreakdown(
    input: Readonly<{
      organizationId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
    }>,
  ): Promise<AuthzAccessBreakdownOutput>;
  isMember(input: Readonly<{ organizationId: string; userId: string }>): Promise<boolean>;
  memberOrganizationIds(
    input: Readonly<{ userId: string; organizationIds: string[] }>,
  ): Promise<string[]>;
  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]>;
  getOldestTeamId(input: GetOldestTeamInput): Promise<string>;
  tryGetOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string | null>;
  findOrganizationWithMembers(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null>;
  findMemberById(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null>;
  getAllMembers(input: Readonly<{ organizationId: string }>): Promise<User[]>;
  findUserOrgRoleByTeamId(
    input: Readonly<{ userId: string; teamId: string }>,
  ): Promise<OrganizationUserRole | null>;
  findPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null>;
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
  ensurePersonalWorkspace(
    input: Omit<PersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<EnsuredPersonalWorkspace>;
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  tryFindPersonalWorkspace(
    input: Omit<FindPersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<PersonalWorkspace | null>;
  updateTeamMemberRole(
    input: Readonly<{ teamId: string; userId: string; role: string; customRoleId?: string }>,
    by: OrganizationCaller,
  ): Promise<void>;
  changeMemberRole(
    input: Readonly<{
      organizationId: string;
      userId: string;
      role: OrganizationUserRole;
      teamRoleUpdates?: { teamId: string; userId: string; role: string; customRoleId?: string }[];
      planUser?: { id: string; name?: string | null; email?: string | null };
    }>,
    by: OrganizationCaller | null,
  ): Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }>;
  getAuditLogs(
    input: Readonly<{
      organizationId: string;
      projectId?: string;
      userId?: string;
      pageOffset: number;
      pageSize: number;
      action?: string;
      startDate?: number;
      endDate?: number;
      targetKind?: string;
      targetId?: string;
    }>,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
  getBillingProfile(input: GetOrganizationBillingProfileInput): Promise<OrganizationBillingProfile>;
  claimBillingCustomerId(
    input: Readonly<{ organizationId: string; billingCustomerId: string }>,
  ): Promise<boolean>;
  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
  createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam>;
  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void>;
  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam>;
  getTeamBySlugForMember(
    input: Omit<GetOrganizationTeamBySlugForMemberInput, "userId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam>;
  getTeamWithMembers(
    input: Omit<GetOrganizationTeamWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers>;
  listTeamsWithMembers(
    input: Omit<ListOrganizationTeamsWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers[]>;
  listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]>;
  createTeamWithMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam>;
  updateTeamWithMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
  removeTeamMember(
    input: Omit<RemoveOrganizationTeamMemberInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage>;
  getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails>;
  listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]>;
  createGroup(
    input: Omit<CreateOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup>;
  renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup>;
  deleteGroup(
    input: Omit<DeleteOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void>;
  removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void>;
  listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupBinding[]>;
  addGroupBinding(
    input: Omit<AddOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroupBinding>;
  removeGroupBinding(
    input: Omit<RemoveOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  applyGroupEdits(
    input: Omit<ApplyOrganizationGroupEditsInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  resolveBindingScopeNames(
    input: Readonly<{ organizationId: string; bindings: readonly OrganizationGroupBinding[] }>,
  ): Promise<ReadonlyMap<string, string>>;
  getPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
  enableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
  disableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
  findProject(id: string): Promise<Project | null>;
  listProjectsByOrganization(
    input: Readonly<{ organizationId: string; page: number; limit: number; projectIds?: string[] }>,
  ): Promise<PaginatedProjects>;
  listProjectsByTeam(
    input: Readonly<{ organizationId: string; teamId: string }>,
  ): Promise<Project[]>;

  // -- the doors ------------------------------------------------------------
  //
  // What each tRPC namespace calls once its transport has stated access. The
  // orchestration these carry - per-viewer redaction, the invitation
  // ceremony, the seat and plan guards - used to sit in the transport, where
  // it could not be tested without a router.

  /** Every organization the caller can reach, redacted for them. */
  listVisibleOrganizations(
    input: Readonly<{ isDemo: boolean }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]>;
  /** One organization with its members, addresses redacted for a non-administrator. */
  getOrganizationWithMembersForPicker(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams>;
  /** One member's full record, refused by name where there is none. */
  getMemberOrRefuse(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser>;

  createInvitations(
    input: OrganizationApiCreateInvitesInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteCreated[]>;
  revokeInvitation(input: OrganizationApiInviteScope): Promise<void>;
  resendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteResent>;
  listPendingInvitations(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationListedInvite[]>;
  acceptInvitation(
    input: Readonly<{ inviteCode: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteAccepted>;

  /** One team-role change, with the personal-team, plan and seat guards. */
  changeTeamMemberRole(
    input: OrganizationApiUpdateTeamMemberRoleInput,
    by: OrganizationCaller,
  ): Promise<void>;
  /** The audit trail, once the plan and the project filter have been cleared. */
  readAuditLogs(
    input: Readonly<{
      organizationId: string;
      projectId?: string;
      userId?: string;
      pageOffset: number;
      pageSize: number;
      action?: string;
      startDate?: number;
      endDate?: number;
      targetKind?: string;
      targetId?: string;
    }>,
    by: OrganizationCaller,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;

  listTeamsWithProjects(
    input: Readonly<{ organizationId: string }>,
    by: OrganizationCaller,
  ): Promise<TeamWithProjects[]>;
  listTeamAccessMatrix(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationTeamAccess[]>;
  getTeamWithProjects(
    input: Readonly<{ organizationId: string; slug: string }>,
    by: OrganizationCaller,
  ): Promise<TeamWithProjects>;
  updateTeamMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void>;
  createTeamWithGatedMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam>;
  archiveTeamById(input: Readonly<{ teamId: string }>): Promise<void>;
  removeTeamMemberById(
    input: Readonly<{ teamId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<void>;

  listGroupsWithScopeNames(input: Readonly<{ organizationId: string }>): Promise<GroupListItem[]>;
  getGroupWithScopeNames(input: GetOrganizationGroupInput): Promise<GroupDetail>;
  createLicensedGroup(
    input: Omit<CreateOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup>;
  listMemberGroupsWithScopeNames(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<GroupMembershipView[]>;

  lookupJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown>;
  listOwnJoinRequests(input: Readonly<{ userId: string }>): Promise<JoinRequestMine>;
  fileJoinRequest(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<JoinRequestFiled>;
  withdrawJoinRequest(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void>;
  listPendingJoinRequests(input: Readonly<{ organizationId: string }>): Promise<JoinRequestPending>;
  approveJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  rejectJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  readJoiningPolicy(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining>;
  setJoiningPolicy(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
    }>,
  ): Promise<JoinRequestJoiningChanged>;

  initializeOrganization(
    input: OnboardingInitializeOrganizationInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInitialized>;
  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void;

  readPersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
  enablePersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
  disablePersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures>;
}

export const OrganizationApi = moduleApi<OrganizationApi>("organization");
