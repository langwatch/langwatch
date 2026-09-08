import { featureApi } from "@langwatch/runtime-composition";
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
  ListOrganizationTeamsWithMembersInput,
  OrganizationTeam,
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
  tryGetProvisioningSummary(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null>;
  deleteProvisionedOrganization(input: { organizationId: string }): Promise<void>;
  isMember(input: Readonly<{ organizationId: string; userId: string }>): Promise<boolean>;
  memberOrganizationIds(
    input: Readonly<{ userId: string; organizationIds: string[] }>,
  ): Promise<string[]>;
  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]>;
  getOldestTeamId(input: GetOldestTeamInput): Promise<string>;
  tryGetOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string | null>;
  tryGetOrganizationWithMembers(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null>;
  tryGetMemberById(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null>;
  getAllMembers(input: Readonly<{ organizationId: string }>): Promise<User[]>;
  tryGetUserOrgRoleByTeamId(
    input: Readonly<{ userId: string; teamId: string }>,
  ): Promise<OrganizationUserRole | null>;
  tryGetPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null>;
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
  tryGetProject(id: string): Promise<Project | null>;
  listProjectsByOrganization(
    input: Readonly<{ organizationId: string; page: number; limit: number; projectIds?: string[] }>,
  ): Promise<PaginatedProjects>;
  listProjectsByTeam(
    input: Readonly<{ organizationId: string; teamId: string }>,
  ): Promise<Project[]>;
}

export const OrganizationApi = featureApi<OrganizationApi>("organization");
