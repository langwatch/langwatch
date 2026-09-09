/**
 * The organization feature's application: what its four tRPC doors (`organization.*`, `team.*`,
 * `group.*`, the personal-workspace nav predicate) call. What lives here is cross-door shared
 * logic; most operations are the services' own, via {@link organizations} and {@link projects}.
 */
import { OrganizationApi, OrganizationGroupService } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { UserApi } from "@langwatch/user-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  AddOrganizationGroupBindingInput,
  AddOrganizationTeamMemberInput,
  ApplyOrganizationGroupEditsInput,
  ChangeOrganizationGroupMemberInput,
  CreateOrganizationGroupInput,
  CreateOrganizationTeamWithMembersInput,
  CreateOrganizationTeamInput,
  DeleteOrganizationGroupInput,
  GetOrganizationBillingProfileInput,
  GetOrganizationIdByTeamIdInput,
  GetOrganizationMembersInput,
  GetOrganizationGroupInput,
  GetOrganizationTeamByIdInput,
  GetOrganizationTeamBySlugForMemberInput,
  GetOrganizationTeamInput,
  GetOrganizationTeamWithMembersInput,
  GetOldestTeamInput,
  ListMemberOrganizationGroupsInput,
  ListOrganizationGroupsInput,
  ListOrganizationTeamAccessInput,
  ListOrganizationTeamsWithMembersInput,
  OrganizationBillingProfile,
  OrganizationGroup,
  OrganizationGroupBinding,
  OrganizationGroupDetails,
  OrganizationGroupPage,
  OrganizationGroupSummary,
  OrganizationService,
  OrganizationTeam,
  OrganizationTeamAccess,
  OrganizationTeamWithMembers,
  EnrichedAuditLog,
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
  PersonalWorkspaceFeaturesInput,
  RemoveOrganizationGroupBindingInput,
  RemoveOrganizationTeamMemberInput,
  RenameOrganizationGroupInput,
  UpdateOrganizationSettingsInput,
  UpdateOrganizationSettingsResult,
  UpdateOrganizationTeamWithMembersInput,
} from "@langwatch/organization-contract";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";
import { PostgresOrganizationAdapter } from "../adapters/postgres.organization.adapter.ts";
import { PostgresOrganizationMembershipAdapter } from "../adapters/postgres.organization-membership.adapter.ts";
import type {
  GroupIdentityPort,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../ports/organization.port.ts";
import {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
} from "../ports/organization-membership.port.ts";
import type {
  CustomRole,
  Organization,
  OrganizationIntent,
  OrganizationUser,
  OrganizationUserRole,
  ProjectRow,
  Team,
  TeamUser,
  User,
} from "@langwatch/organization-contract";
import type { PaginatedProjects, Project } from "@langwatch/project-contract";
import { OrganizationGroupScopeService } from "../services/organization-group-scope.service.ts";
import {
  organizationMemberDatesFromDate,
  organizationProvisioningSummaryFromDate,
} from "../rules/organization-time-boundary.rules.ts";

// ---------------------------------------------------------------------------
// The rows this application hands back — restated from the composed service's own generated
// Prisma models, so the shapes a transport publishes stay byte-identical to the source rows.
// ---------------------------------------------------------------------------

type TeamWithProjectsAndMembers = Team & {
  projects: ProjectRow[];
  members: (TeamUser & { assignedRole?: CustomRole | null })[];
};

/** One organization with every team, project and member row loaded. */
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

// ---------------------------------------------------------------------------
// What the process composes this feature's application from
// ---------------------------------------------------------------------------

/**
 * The organization reads and writes this feature makes that the canonical `OrganizationService`
 * contract does not declare — membership, invitations, the audit trail. Named structurally
 * rather than picked, since none of these fourteen live in the contract.
 */
type OrganizationMembershipPort = OrganizationMembershipService;

/** The three project reads an organization screen makes: what lives where. */
type OrganizationProjectApi = ProjectApi;

/** Who a write is attributed to. */
export interface OrganizationCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface ServerOrganizationAppDependencies {
  organizations: OrganizationService;
  membership: OrganizationMembershipService;
  groups: OrganizationGroupService;
  projects: OrganizationProjectApi;
}

type OrganizationSetup = FeatureSetup<
  { projects: typeof ProjectApi; permissions: typeof AuthzApi; users: typeof UserApi },
  OrganizationInfrastructure,
  undefined
>;

export type OrganizationInfrastructure = Readonly<{
  database: PrismaClient;
  identities: PersonalWorkspaceIdentityPort;
  teamIdentities: TeamIdentityPort;
  groupIdentities: GroupIdentityPort;
  settingsSecrets: OrganizationSettingsSecretPort;
  diagnostics?: PersonalWorkspaceDiagnosticsPort;
  prompts: OrganizationPromptSeedPort;
  seats: OrganizationSeatLicensePort;
}>;

export class ServerOrganizationApp implements OrganizationApi {
  static readonly contract = OrganizationApi;
  static readonly dependencies = {
    projects: ProjectApi,
    permissions: AuthzApi,
    users: UserApi,
  };
  #dependencies: ServerOrganizationAppDependencies;

  static create(setup: OrganizationSetup): ServerOrganizationApp {
    const organizations = PostgresOrganizationAdapter.create({
      database: setup.infrastructure.database,
      identities: setup.infrastructure.identities,
      teamIdentities: setup.infrastructure.teamIdentities,
      groupIdentities: setup.infrastructure.groupIdentities,
      authz: setup.dependencies.permissions,
      grants: setup.dependencies.permissions,
      settingsSecrets: setup.infrastructure.settingsSecrets,
      diagnostics: setup.infrastructure.diagnostics,
    }).build();
    const membership = PostgresOrganizationMembershipAdapter.create({
      database: setup.infrastructure.database,
      grants: setup.dependencies.permissions,
      prompts: setup.infrastructure.prompts,
      seats: setup.infrastructure.seats,
      sessions: UserApiOrganizationSessionRevocation.create(setup.dependencies.users),
      grantCache: AuthzApiOrganizationGrantCache.create(setup.dependencies.permissions),
    }).build();
    return new ServerOrganizationApp({
      organizations,
      membership,
      groups: OrganizationGroupScopeService.create({
        organizations,
        projects: setup.dependencies.projects,
      }),
      projects: setup.dependencies.projects,
    });
  }

  private constructor(dependencies: ServerOrganizationAppDependencies) {
    this.#dependencies = dependencies;
  }

  /** The ledger actor a write is recorded under — one spelling, shared by every door. */
  #ledgerActor(by: OrganizationCaller): { type: "user"; id: string } {
    return { type: "user", id: by.id };
  }

  // -- the organization, its membership and its invitations ------------------

  /** Sign-up: the caller's first organization and its first team. */
  createAndAssign(
    input: Omit<Parameters<OrganizationMembershipPort["createAndAssign"]>[0], "userId">,
    by: OrganizationCaller,
  ): ReturnType<OrganizationMembershipPort["createAndAssign"]> {
    return this.#dependencies.membership.createAndAssign({ ...input, userId: by.id });
  }

  /** Removes one seat, attributed to the caller who asked for it. */
  deleteMember(
    input: Omit<Parameters<OrganizationMembershipPort["deleteMember"]>[0], "actingUserId">,
    by: OrganizationCaller | null,
  ): Promise<void> {
    return this.#dependencies.membership.deleteMember({ ...input, actingUserId: by?.id ?? null });
  }

  /** Frees a seat reversibly. The acting user travels whole, since the disable
   * guard identifies the operator by more than their id. */
  setMemberDisabled(
    input: Omit<Parameters<OrganizationMembershipPort["setMemberDisabled"]>[0], "actingUser">,
    by: (OrganizationCaller & { name?: string | null; email?: string | null }) | null,
  ): Promise<void> {
    return this.#dependencies.membership.setMemberDisabled({
      ...input,
      actingUser: by ? { id: by.id, name: by.name ?? null, email: by.email ?? null } : null,
    });
  }

  /** Every organization the caller can reach, fully loaded. */
  getAllForUser(
    input: Omit<Parameters<OrganizationMembershipPort["getAllForUser"]>[0], "userId">,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]> {
    return this.#dependencies.membership.getAllForUser({ ...input, userId: by.id });
  }

  /**
   * Saves the settings form and hands back whether turning trace sharing off means every
   * existing share link now has to be revoked (ADR-057) — only the write saw the stored value
   * beforehand, so the answer is carried through rather than dropped here.
   */
  updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult> {
    return this.#dependencies.organizations.updateSettings(input);
  }

  getSettings(input: { organizationId: string }) {
    return this.#dependencies.organizations.getSettings(input);
  }

  listMembers(input: Parameters<OrganizationMembershipService["listMembers"]>[0]) {
    return this.#dependencies.membership.listMembers(input).then((result) => ({
      ...result,
      members: result.members.map((member) => ({
        ...member,
        ...organizationMemberDatesFromDate(member),
      })),
    }));
  }

  getMember(input: Parameters<OrganizationMembershipService["getMember"]>[0]) {
    return this.#dependencies.membership.getMember(input).then((member) => ({
      ...member,
      ...organizationMemberDatesFromDate(member),
    }));
  }

  createForProvisioning(
    input: Parameters<OrganizationMembershipService["createForProvisioning"]>[0],
  ) {
    return this.#dependencies.membership.createForProvisioning(input);
  }

  listProvisioningSummaries() {
    return this.#dependencies.membership
      .listProvisioningSummaries()
      .then((summaries) => summaries.map(organizationProvisioningSummaryFromDate));
  }

  tryGetProvisioningSummary(organizationId: string) {
    return this.#dependencies.membership
      .tryGetProvisioningSummary(organizationId)
      .then((summary) =>
        summary === null ? null : organizationProvisioningSummaryFromDate(summary),
      );
  }

  deleteProvisionedOrganization(
    input: Parameters<OrganizationMembershipService["deleteProvisionedOrganization"]>[0],
  ) {
    return this.#dependencies.membership.deleteProvisionedOrganization(input);
  }

  /** Whether a user is a member of an organization — a door the feature-flag resolver asks
   * on every organization-targeted read, to gate whether the caller may see a flag's answer. */
  isMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.#dependencies.organizations.isMember(input);
  }

  /** The batched form of {@link isMember}, for the feature-flag resolver: the workspace switcher
   * asks a flag per listed organization, and this avoids a membership query per row. */
  memberOrganizationIds(input: { userId: string; organizationIds: string[] }): Promise<string[]> {
    return this.#dependencies.organizations.memberOrganizationIds(input);
  }

  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]> {
    return this.#dependencies.organizations.getOrganizationMembers(input);
  }

  getOldestTeamId(input: GetOldestTeamInput): Promise<string> {
    return this.#dependencies.organizations.getOldestTeamId(input);
  }

  tryGetOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string | null> {
    return this.#dependencies.organizations.tryGetOrganizationIdByTeamId(input);
  }

  /** One organization with its members and each member's teams. */
  tryGetOrganizationWithMembers(
    input: Omit<
      Parameters<OrganizationMembershipPort["tryGetOrganizationWithMembers"]>[0],
      "userId"
    >,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.#dependencies.membership.tryGetOrganizationWithMembers({
      ...input,
      userId: by.id,
    });
  }

  /** One member, redacted to what the calling member may see. */
  tryGetMemberById(
    input: Omit<Parameters<OrganizationMembershipPort["tryGetMemberById"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null> {
    return this.#dependencies.membership.tryGetMemberById({ ...input, currentUserId: by.id });
  }

  /** Every member of one organization, for the member pickers. */
  getAllMembers(input: { organizationId: string }): Promise<User[]> {
    return this.#dependencies.membership.getAllMembers(input.organizationId);
  }

  /** The role a user holds in the organization owning one team — read by the project-protections
   * resolver, since a user with no team binding may still reach a project via an org-wide role. */
  tryGetUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.#dependencies.membership.tryGetUserOrgRoleByTeamId(input);
  }

  /**
   * The organization's declared primary intent (ADR-038), or null where it was
   * never set. The governance setup screen reads it to decide which checklist
   * the organization is being walked through.
   */
  tryGetPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.#dependencies.membership.tryGetPrimaryIntent(organizationId);
  }

  /** Makes the caller's personal workspace in this organization exist. */
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
  ensurePersonalWorkspace(
    input: Omit<PersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<EnsuredPersonalWorkspace>;
  ensurePersonalWorkspace(
    input: PersonalWorkspaceInput | Omit<PersonalWorkspaceInput, "userId">,
    by?: OrganizationCaller,
  ): Promise<EnsuredPersonalWorkspace> {
    const userId = by?.id ?? ("userId" in input ? input.userId : void 0);
    if (userId === void 0) throw new Error("A user is required to ensure a personal workspace");
    return this.#dependencies.organizations.ensurePersonalWorkspace({ ...input, userId });
  }

  /**
   * The caller's personal workspace in this organization, or `null` when they
   * have none. The read half of `ensurePersonalWorkspace` above, for the
   * callers that must not create one as a side effect of asking.
   */
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  tryFindPersonalWorkspace(
    input: Omit<FindPersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<PersonalWorkspace | null>;
  tryFindPersonalWorkspace(
    input: FindPersonalWorkspaceInput | Omit<FindPersonalWorkspaceInput, "userId">,
    by?: OrganizationCaller,
  ): Promise<PersonalWorkspace | null> {
    const userId = by?.id ?? ("userId" in input ? input.userId : void 0);
    if (userId === void 0) throw new Error("A user is required to find a personal workspace");
    return this.#dependencies.organizations.tryFindPersonalWorkspace({ ...input, userId });
  }

  /** Changes one member's role inside one team. */
  updateTeamMemberRole(
    input: Omit<Parameters<OrganizationMembershipPort["updateTeamMemberRole"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.membership.updateTeamMemberRole({
      ...input,
      currentUserId: by.id,
    });
  }

  /** Changes one member's organization role, with its team-role fallout. */
  changeMemberRole(
    input: Omit<Parameters<OrganizationMembershipPort["changeMemberRole"]>[0], "currentUserId">,
    by: OrganizationCaller | null,
  ): ReturnType<OrganizationMembershipPort["changeMemberRole"]> {
    return this.#dependencies.membership.changeMemberRole({
      ...input,
      currentUserId: by?.id ?? null,
    });
  }

  /** The organization's audit trail, one page at a time. */
  getAuditLogs(
    input: Parameters<OrganizationMembershipPort["getAuditLogs"]>[0],
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return this.#dependencies.membership.getAuditLogs(input);
  }

  /** The billing-facing profile, which is also where the display name lives. */
  getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile> {
    return this.#dependencies.organizations.getBillingProfile(input);
  }

  // -- teams -----------------------------------------------------------------

  /** One team by id. */
  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.getTeam(input);
  }

  createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.createTeam(input);
  }

  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    return this.#dependencies.organizations.addTeamMember(input);
  }

  /** One team by id, without naming its organization. */
  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.getTeamById(input);
  }

  /** The team behind a `/[team]` route, resolved for the caller. */
  getTeamBySlugForMember(
    input: Omit<GetOrganizationTeamBySlugForMemberInput, "userId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.getTeamBySlugForMember({ ...input, userId: by.id });
  }

  listTeams(
    input: import("@langwatch/organization-contract").ListOrganizationTeamsInput,
  ): Promise<import("@langwatch/organization-contract").OrganizationTeamPage> {
    return this.#dependencies.organizations.listTeams(input);
  }

  /** One team's members, filtered against what the caller may see. */
  getTeamWithMembers(
    input: Omit<GetOrganizationTeamWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers> {
    return this.#dependencies.organizations.getTeamWithMembers({
      ...input,
      callerUserId: by.id,
    });
  }

  /** The organization's teams with their members, filtered the same way. */
  listTeamsWithMembers(
    input: Omit<ListOrganizationTeamsWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers[]> {
    return this.#dependencies.organizations.listTeamsWithMembers({
      ...input,
      callerUserId: by.id,
    });
  }

  /** The access matrix the team-permissions screen renders. */
  listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]> {
    return this.#dependencies.organizations.listTeamAccess(input);
  }

  /** Creates a team with its initial members, attributed to its caller. */
  createTeamWithMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.createTeamWithMembers({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Saves the team settings form's whole diff, attributed to its caller. */
  updateTeamWithMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.updateTeamWithMembers({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Archives one team. */
  archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.archiveTeam(input);
  }

  /** Removes one member from a team, attributed to its caller. */
  removeTeamMember(
    input: Omit<RemoveOrganizationTeamMemberInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.removeTeamMember({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  // -- groups ----------------------------------------------------------------

  /** Every group in the organization, one page at a time. */
  listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    return this.#dependencies.organizations.listGroups(input);
  }

  /** One group with its bindings and its members. */
  getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    return this.#dependencies.organizations.getGroup(input);
  }

  /** The groups one member is in. */
  listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    return this.#dependencies.organizations.listGroupsForMember(input);
  }

  resolveBindingScopeNames(input: {
    organizationId: string;
    bindings: readonly import("@langwatch/organization-contract").OrganizationGroupBinding[];
  }): Promise<ReadonlyMap<string, string>> {
    return this.#dependencies.groups.resolveBindingScopeNames(input);
  }

  /** Creates a group, attributed to the caller who asked for it. */
  createGroup(
    input: Omit<CreateOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup> {
    return this.#dependencies.organizations.createGroup({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Renames one group. */
  renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup> {
    return this.#dependencies.organizations.renameGroup(input);
  }

  /** Deletes one group, attributed to the caller who asked for it. */
  deleteGroup(
    input: Omit<DeleteOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.deleteGroup({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Adds one member to a group. */
  addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.#dependencies.organizations.addGroupMember(input);
  }

  /** Removes one member from a group. */
  removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.#dependencies.organizations.removeGroupMember(input);
  }

  /** Adds one access binding to a group, attributed to its caller. */
  addGroupBinding(
    input: Omit<AddOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroupBinding> {
    return this.#dependencies.organizations.addGroupBinding({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Removes one access binding from a group, attributed to its caller. */
  removeGroupBinding(
    input: Omit<RemoveOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.removeGroupBinding({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Applies the group editor's whole diff, attributed to its caller. */
  applyGroupEdits(
    input: Omit<ApplyOrganizationGroupEditsInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.applyGroupEdits({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  // -- the personal workspace's own feature switches -------------------------
  //
  // All three take the caller rather than reading one, because who is asking
  // IS the authorization here: a personal workspace belongs to its owner, and
  // the service refuses a caller who is not that owner.

  /** Which product areas this personal workspace offers. */
  getPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.#dependencies.organizations.getPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  /** Turns every personal-workspace feature on. */
  enableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.#dependencies.organizations.enableAllPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  /** Turns every personal-workspace feature off. */
  disableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.#dependencies.organizations.disableAllPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  // -- the projects an organization's teams hold -----------------------------

  /** One project, or null when it does not exist. */
  tryGetProject(id: string): Promise<Project | null> {
    return this.#dependencies.projects.tryGetById(id);
  }

  /** The organization's projects, one page at a time. */
  listProjectsByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    return this.#dependencies.projects.listByOrganization(input);
  }

  /** The projects that live in one team. */
  listProjectsByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.#dependencies.projects.listByTeam(input);
  }
}

class UserApiOrganizationSessionRevocation extends OrganizationSessionRevocationPort {
  static create(users: import("@langwatch/user-contract").UserApi): UserApiOrganizationSessionRevocation {
    return new UserApiOrganizationSessionRevocation(users);
  }

  private constructor(private readonly users: import("@langwatch/user-contract").UserApi) {
    super();
  }

  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.users.revokeAllBrowserSessions(input);
  }
}

class AuthzApiOrganizationGrantCache extends OrganizationGrantCachePort {
  static create(authz: import("@langwatch/authz-contract").AuthzApi): AuthzApiOrganizationGrantCache {
    return new AuthzApiOrganizationGrantCache(authz);
  }

  private constructor(private readonly authz: import("@langwatch/authz-contract").AuthzApi) {
    super();
  }

  invalidateOrganization(input: { organizationId: string }): Promise<void> {
    return this.authz.invalidateOrganization(input);
  }
}

/** Test-only construction over stub services without weakening the production factory. */
export function createOrganizationAppForTesting(setup: {
  infrastructure: Omit<ServerOrganizationAppDependencies, "groups"> & {
    groups?: OrganizationGroupService;
  };
  [key: string]: unknown;
}): ServerOrganizationApp {
  const { groups, ...dependencies } = setup.infrastructure;
  const Constructor = ServerOrganizationApp as unknown as new (
    dependencies: ServerOrganizationAppDependencies,
  ) => ServerOrganizationApp;
  return new Constructor({
    ...dependencies,
    groups:
      groups ??
      OrganizationGroupScopeService.create({
        organizations: dependencies.organizations,
        projects: dependencies.projects,
      }),
  });
}
