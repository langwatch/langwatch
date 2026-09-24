import type { AuthzAccessBreakdownOutput, GrantsLedgerActor } from "@langwatch/authz-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import type { PaginatedProjects, Project } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

import type { GroupDetail, GroupListItem, GroupMembershipView } from "./group.responses.ts";
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
  JoinRequestAdmitted,
  JoinRequestAutomaticJoins,
  JoinRequestFiled,
  JoinRequestJoining,
  JoinRequestJoiningChanged,
  JoinRequestMine,
  JoinRequestPending,
} from "./join-request.responses.ts";
import type { OrganizationInitialized } from "./onboarding.responses.ts";
import type { OnboardingInitializeOrganizationInput } from "./onboarding.trpc.ts";
import type {
  OrganizationInviteAccepted,
  OrganizationInviteCreated,
  OrganizationInviteResent,
  OrganizationListedInvite,
  OrganizationMemberProvenance,
  OrganizationPendingInviteApplied,
} from "./organization.responses.ts";
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
  OrganizationApiCreateInvitesInput,
  OrganizationApiInviteScope,
  OrganizationApiUpdateTeamMemberRoleInput,
} from "./organization.trpc-schemas.ts";
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
import type * as organizationModule from "./organization.ts";
import type {
  FindPersonalWorkspaceInput,
  EnsuredPersonalWorkspace,
  PersonalFeatures,
  PersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceFeaturesInput,
} from "./personal-workspace.ts";
import type { TeamWithProjects } from "./team.responses.ts";
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

/**
 * An invitation naming an unassignable team/role: `strict` refuses the batch
 * (provisioning callers), `lenient` drops the assignment and carries on (the
 * invite form's historical behaviour). The transport picks, outside any schema.
 */
export type OrganizationInviteValidation = "strict" | "lenient";

/** One invitation batch as a transport asks for it, with the mode it chose. */
export type OrganizationApiCreateInvitationsInput = OrganizationApiCreateInvitesInput &
  Readonly<{ validation: OrganizationInviteValidation }>;

/** One administrator, as a peer that must name them reads them. */
export interface OrganizationAdministrator {
  userId: string;
  name: string | null;
  email: string | null;
}

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * members, the single sign-on providers named (by name only), and when the
 * second member joined, the first being whoever installed it. Epoch ms.
 */
export interface OrganizationUsageCount {
  readonly members: number;
  readonly ssoProviders: string[];
  readonly secondMemberJoinedAt?: number;
}

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
  /**
   * Refuses when taking this member out would leave the organization with no
   * administrator who can sign in. Asked by a caller that writes the
   * membership row itself — a directory deprovision — before it does.
   */
  assertRemovalKeepsAnAdministrator(
    input: Readonly<{ organizationId: string; userId: string }>,
  ): Promise<void>;
  getAllForUser(
    input: Readonly<{ isDemo: boolean; demoProjectUserId: string; demoProjectId: string }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]>;
  /**
   * The guided-onboarding record the organization carries, in the column the
   * organization owns. An organization nobody has onboarded reads as the
   * empty state with no variant; an unknown one refuses by name.
   */
  readGuidedOnboardingState(input: { organizationId: string }): Promise<GuidedOnboardingRecord>;
  /**
   * How colleagues on a matching domain get in, in the columns the
   * organization owns; identity's join ledger reads and writes it here.
   */
  getJoinSetting(input: { organizationId: string }): Promise<JoinRequestJoining>;
  saveJoinSetting(input: { organizationId: string; setting: JoinRequestJoining }): Promise<void>;
  /** Replaces the record, leaving every other sign-up answer where it is. */
  writeGuidedOnboardingState(input: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord>;
  updateSettings(input: UpdateOrganizationSettingsInput): Promise<UpdateOrganizationSettingsResult>;
  getSettings(input: { organizationId: string }): Promise<organizationModule.OrganizationSettings>;
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
  findProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary | null>;
  deleteProvisionedOrganization(input: { organizationId: string }): Promise<void>;
  /** A self-hosted licence customer: the organization and its first team, marked. */
  createSelfHostedCustomer(input: { name: string }): Promise<{ id: string; name: string }>;
  markSelfHostedCustomer(input: { organizationId: string }): Promise<void>;
  /** Every organization an operator marked as a self-hosted licence customer. */
  findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]>;
  /**
   * The organization's longest-standing member, the person a customer's CRM traits are
   * written through, with its name; empty where it has no member.
   */
  findRepresentatives(input: {
    organizationId: string;
  }): Promise<{ userId: string; organizationName: string }[]>;
  /**
   * Provisions an organization end to end: it, its first team, a bootstrap
   * admin key, the summary. A failure past creation deletes the organization
   * and reports a failed compensation rather than raising it over the cause.
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
  /**
   * Makes somebody a MEMBER (ADR-129). With `admittedBy` the grant lands now,
   * audited to that actor; without it an SSO arrival resumes the admission.
   * `"already-present"` when a concurrent callback or a retry made the row.
   */
  createMembership(
    input: Readonly<{
      organizationId: string;
      userId: string;
      admittedBy?: Readonly<{ actor: GrantsLedgerActor; commandId: string }>;
    }>,
  ): Promise<"created" | "already-present">;
  isMember(input: Readonly<{ organizationId: string; userId: string }>): Promise<boolean>;
  memberOrganizationIds(
    input: Readonly<{ userId: string; organizationIds: string[] }>,
  ): Promise<string[]>;
  /**
   * Every organization this person belongs to. Asked by a peer deciding something about the person
   * rather than about a listed organization.
   */
  organizationIdsForMember(input: Readonly<{ userId: string }>): Promise<string[]>;
  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]>;
  getOldestTeamId(input: GetOldestTeamInput): Promise<string>;
  /** Throws `organization_not_found_for_team` when no organization owns the team. */
  getOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string>;
  findOrganizationWithMembers(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null>;
  findMemberById(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null>;
  getAllMembers(input: Readonly<{ organizationId: string }>): Promise<User[]>;
  /** Why each member is here, keyed by user id; explains, never grants. */
  getMemberProvenance(
    input: Readonly<{ organizationId: string }>,
  ): Promise<Record<string, OrganizationMemberProvenance>>;
  /**
   * Every administrator who can still sign in, with what to call them. Asked
   * by a peer choosing somebody for a decision of an administrator's weight —
   * a way back in, today — which an id on its own cannot be made.
   */
  findAdministrators(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationAdministrator[]>;
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
  // orchestration here - redaction, the invitation ceremony, the seat and plan
  // guards - used to live in the transport, untestable without a router.

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
    input: OrganizationApiCreateInvitationsInput,
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
  /**
   * Applies the PENDING invitation this address already holds here, for a
   * caller that never saw an invitation code. Its role and team assignments
   * replace a default membership entirely.
   */
  applyPendingInvite(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied>;

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
  /** Audited against `actorUserId`, the administrator who saved it. */
  setJoiningPolicy(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      actorUserId: string;
    }>,
  ): Promise<JoinRequestJoiningChanged>;
  /** The post-login offer: the lookup minus the domains this person dismissed. */
  offerJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown>;
  dismissJoinOffer(input: Readonly<{ userId: string }>): Promise<void>;
  admitAutomatically(input: Readonly<{ userId: string }>): Promise<JoinRequestAdmitted>;
  listAutomaticJoins(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestAutomaticJoins>;

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
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { organizationIds: readonly string[] }): Promise<OrganizationUsageCount>;
  /** Every organization on this install, for the install-wide usage report. */
  findAllIds(): Promise<string[]>;
}

export const OrganizationApi = moduleApi<OrganizationApi>()("organization");
