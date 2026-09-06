/**
 * The organization feature's application: what its four tRPC doors (`organization.*`, `team.*`,
 * `group.*`, the personal-workspace nav predicate) call. What lives here is cross-door shared
 * logic; most operations are the services' own, via {@link organizations} and {@link projects}.
 */
import type {
  AddOrganizationGroupBindingInput,
  ApplyOrganizationGroupEditsInput,
  ChangeOrganizationGroupMemberInput,
  CreateOrganizationGroupInput,
  CreateOrganizationTeamWithMembersInput,
  DeleteOrganizationGroupInput,
  GetOrganizationBillingProfileInput,
  GetOrganizationGroupInput,
  GetOrganizationTeamByIdInput,
  GetOrganizationTeamBySlugForMemberInput,
  GetOrganizationTeamInput,
  GetOrganizationTeamWithMembersInput,
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
  PersonalWorkspaceFeaturesInput,
  RemoveOrganizationGroupBindingInput,
  RemoveOrganizationTeamMemberInput,
  RenameOrganizationGroupInput,
  UpdateOrganizationSettingsInput,
  UpdateOrganizationSettingsResult,
  UpdateOrganizationTeamWithMembersInput,
} from "@langwatch/organization-contract";
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
import type { PaginatedProjects, Project, ProjectService } from "@langwatch/project-contract";

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
type OrganizationsAppService = Readonly<{
  createAndAssign(input: {
    userId: string;
    orgName?: string;
    phoneNumber?: string;
    signUpData?: Record<string, unknown>;
    primaryIntent?: OrganizationIntent | null;
    userDisplayName?: string | null;
  }): Promise<{
    organization: { id: string; name: string };
    team: { id: string; slug: string; name: string };
  }>;
  deleteMember(input: {
    organizationId: string;
    userId: string;
    actingUserId?: string | null;
  }): Promise<void>;
  setMemberDisabled(input: {
    organizationId: string;
    userId: string;
    disabled: boolean;
    actingUser?: { id: string; name?: string | null; email?: string | null } | null;
  }): Promise<void>;
  getAllForUser(input: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]>;
  tryGetOrganizationWithMembers(input: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null>;
  tryGetMemberById(input: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null>;
  getAllMembers(organizationId: string): Promise<User[]>;
  tryGetUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null>;
  tryGetPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null>;
  ensurePersonalWorkspace(input: {
    userId: string;
    organizationId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<EnsuredPersonalWorkspace>;
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  updateTeamMemberRole(input: {
    teamId: string;
    userId: string;
    role: string;
    customRoleId?: string;
    currentUserId: string;
  }): Promise<void>;
  changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    teamRoleUpdates?: {
      teamId: string;
      userId: string;
      role: string;
      customRoleId?: string;
    }[];
    currentUserId: string;
    planUser?: { id: string; name?: string | null; email?: string | null };
  }): Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }>;
  getAuditLogs(input: {
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
  }): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
}>;

/**
 * The contract reads and writes this feature makes, named rather than taking
 * `OrganizationService` whole: an organization screen has no business depending on the
 * ingestion or billing parts of that widest-in-the-platform surface.
 */
type OrganizationContractService = Pick<
  OrganizationService,
  // the organization's own settings
  | "updateSettings"
  // membership, asked by the feature-flag resolver before it widens a
  // project-scoped read into an organization-scoped one
  | "isMember"
  | "memberOrganizationIds"
  // groups
  | "getBillingProfile"
  | "getTeam"
  | "listGroups"
  | "getGroup"
  | "listGroupsForMember"
  | "createGroup"
  | "renameGroup"
  | "deleteGroup"
  | "addGroupMember"
  | "removeGroupMember"
  | "addGroupBinding"
  | "removeGroupBinding"
  | "applyGroupEdits"
  // teams
  | "getTeamBySlugForMember"
  | "getTeamWithMembers"
  | "listTeamsWithMembers"
  | "listTeamAccess"
  | "getTeamById"
  | "createTeamWithMembers"
  | "updateTeamWithMembers"
  | "archiveTeam"
  | "removeTeamMember"
  // the personal workspace's own feature switches
  | "getPersonalWorkspaceFeatures"
  | "enableAllPersonalWorkspaceFeatures"
  | "disableAllPersonalWorkspaceFeatures"
>;

/** The three project reads an organization screen makes: what lives where. */
type OrganizationProjectService = Pick<
  ProjectService,
  "tryGetById" | "listByOrganization" | "listByTeam"
>;

/** Who a write is attributed to. */
export interface OrganizationCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface OrganizationAppDependencies {
  organizations: OrganizationsAppService & OrganizationContractService;
  projects: OrganizationProjectService;
}

export class OrganizationApp {
  static create(dependencies: OrganizationAppDependencies): OrganizationApp {
    return new OrganizationApp(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationAppDependencies) {}

  /** The ledger actor a write is recorded under — one spelling, shared by every door. */
  private ledgerActor(by: OrganizationCaller): { type: "user"; id: string } {
    return { type: "user", id: by.id };
  }

  // -- the organization, its membership and its invitations ------------------

  /** Sign-up: the caller's first organization and its first team. */
  createAndAssign(
    input: Omit<Parameters<OrganizationsAppService["createAndAssign"]>[0], "userId">,
    by: OrganizationCaller,
  ): ReturnType<OrganizationsAppService["createAndAssign"]> {
    return this.dependencies.organizations.createAndAssign({ ...input, userId: by.id });
  }

  /** Removes one seat, attributed to the caller who asked for it. */
  deleteMember(
    input: Omit<Parameters<OrganizationsAppService["deleteMember"]>[0], "actingUserId">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.deleteMember({ ...input, actingUserId: by.id });
  }

  /** Frees a seat reversibly. The acting user travels whole, since the disable
   * guard identifies the operator by more than their id. */
  setMemberDisabled(
    input: Omit<Parameters<OrganizationsAppService["setMemberDisabled"]>[0], "actingUser">,
    by: OrganizationCaller & { name?: string | null; email?: string | null },
  ): Promise<void> {
    return this.dependencies.organizations.setMemberDisabled({
      ...input,
      actingUser: { id: by.id, name: by.name ?? null, email: by.email ?? null },
    });
  }

  /** Every organization the caller can reach, fully loaded. */
  getAllForUser(
    input: Omit<Parameters<OrganizationsAppService["getAllForUser"]>[0], "userId">,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]> {
    return this.dependencies.organizations.getAllForUser({ ...input, userId: by.id });
  }

  /**
   * Saves the settings form and hands back whether turning trace sharing off means every
   * existing share link now has to be revoked (ADR-057) — only the write saw the stored value
   * beforehand, so the answer is carried through rather than dropped here.
   */
  updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult> {
    return this.dependencies.organizations.updateSettings(input);
  }

  /** Whether a user is a member of an organization — a door the feature-flag resolver asks
   * on every organization-targeted read, to gate whether the caller may see a flag's answer. */
  isMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.dependencies.organizations.isMember(input);
  }

  /** The batched form of {@link isMember}, for the feature-flag resolver: the workspace switcher
   * asks a flag per listed organization, and this avoids a membership query per row. */
  memberOrganizationIds(input: { userId: string; organizationIds: string[] }): Promise<string[]> {
    return this.dependencies.organizations.memberOrganizationIds(input);
  }

  /** One organization with its members and each member's teams. */
  tryGetOrganizationWithMembers(
    input: Omit<Parameters<OrganizationsAppService["tryGetOrganizationWithMembers"]>[0], "userId">,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.dependencies.organizations.tryGetOrganizationWithMembers({
      ...input,
      userId: by.id,
    });
  }

  /** One member, redacted to what the calling member may see. */
  tryGetMemberById(
    input: Omit<Parameters<OrganizationsAppService["tryGetMemberById"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null> {
    return this.dependencies.organizations.tryGetMemberById({ ...input, currentUserId: by.id });
  }

  /** Every member of one organization, for the member pickers. */
  getAllMembers(input: { organizationId: string }): Promise<User[]> {
    return this.dependencies.organizations.getAllMembers(input.organizationId);
  }

  /** The role a user holds in the organization owning one team — read by the project-protections
   * resolver, since a user with no team binding may still reach a project via an org-wide role. */
  tryGetUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.dependencies.organizations.tryGetUserOrgRoleByTeamId(input);
  }

  /**
   * The organization's declared primary intent (ADR-038), or null where it was
   * never set. The governance setup screen reads it to decide which checklist
   * the organization is being walked through.
   */
  tryGetPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.dependencies.organizations.tryGetPrimaryIntent(organizationId);
  }

  /** Makes the caller's personal workspace in this organization exist. */
  ensurePersonalWorkspace(
    input: Omit<Parameters<OrganizationsAppService["ensurePersonalWorkspace"]>[0], "userId">,
    by: OrganizationCaller,
  ): Promise<EnsuredPersonalWorkspace> {
    return this.dependencies.organizations.ensurePersonalWorkspace({ ...input, userId: by.id });
  }

  /**
   * The caller's personal workspace in this organization, or `null` when they
   * have none. The read half of `ensurePersonalWorkspace` above, for the
   * callers that must not create one as a side effect of asking.
   */
  tryFindPersonalWorkspace(
    input: Omit<FindPersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<PersonalWorkspace | null> {
    return this.dependencies.organizations.tryFindPersonalWorkspace({ ...input, userId: by.id });
  }

  /** Changes one member's role inside one team. */
  updateTeamMemberRole(
    input: Omit<Parameters<OrganizationsAppService["updateTeamMemberRole"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.updateTeamMemberRole({
      ...input,
      currentUserId: by.id,
    });
  }

  /** Changes one member's organization role, with its team-role fallout. */
  changeMemberRole(
    input: Omit<Parameters<OrganizationsAppService["changeMemberRole"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): ReturnType<OrganizationsAppService["changeMemberRole"]> {
    return this.dependencies.organizations.changeMemberRole({ ...input, currentUserId: by.id });
  }

  /** The organization's audit trail, one page at a time. */
  getAuditLogs(
    input: Parameters<OrganizationsAppService["getAuditLogs"]>[0],
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    return this.dependencies.organizations.getAuditLogs(input);
  }

  /** The billing-facing profile, which is also where the display name lives. */
  getBillingProfile(
    input: GetOrganizationBillingProfileInput,
  ): Promise<OrganizationBillingProfile> {
    return this.dependencies.organizations.getBillingProfile(input);
  }

  // -- teams -----------------------------------------------------------------

  /** One team by id. */
  getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.dependencies.organizations.getTeam(input);
  }

  /** One team by id, without naming its organization. */
  getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam> {
    return this.dependencies.organizations.getTeamById(input);
  }

  /** The team behind a `/[team]` route, resolved for the caller. */
  getTeamBySlugForMember(
    input: Omit<GetOrganizationTeamBySlugForMemberInput, "userId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    return this.dependencies.organizations.getTeamBySlugForMember({ ...input, userId: by.id });
  }

  /** One team's members, filtered against what the caller may see. */
  getTeamWithMembers(
    input: Omit<GetOrganizationTeamWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers> {
    return this.dependencies.organizations.getTeamWithMembers({
      ...input,
      callerUserId: by.id,
    });
  }

  /** The organization's teams with their members, filtered the same way. */
  listTeamsWithMembers(
    input: Omit<ListOrganizationTeamsWithMembersInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeamWithMembers[]> {
    return this.dependencies.organizations.listTeamsWithMembers({
      ...input,
      callerUserId: by.id,
    });
  }

  /** The access matrix the team-permissions screen renders. */
  listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]> {
    return this.dependencies.organizations.listTeamAccess(input);
  }

  /** Creates a team with its initial members, attributed to its caller. */
  createTeamWithMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    return this.dependencies.organizations.createTeamWithMembers({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Saves the team settings form's whole diff, attributed to its caller. */
  updateTeamWithMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.updateTeamWithMembers({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Archives one team. */
  archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.dependencies.organizations.archiveTeam(input);
  }

  /** Removes one member from a team, attributed to its caller. */
  removeTeamMember(
    input: Omit<RemoveOrganizationTeamMemberInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.removeTeamMember({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  // -- groups ----------------------------------------------------------------

  /** Every group in the organization, one page at a time. */
  listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    return this.dependencies.organizations.listGroups(input);
  }

  /** One group with its bindings and its members. */
  getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    return this.dependencies.organizations.getGroup(input);
  }

  /** The groups one member is in. */
  listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    return this.dependencies.organizations.listGroupsForMember(input);
  }

  /** Creates a group, attributed to the caller who asked for it. */
  createGroup(
    input: Omit<CreateOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup> {
    return this.dependencies.organizations.createGroup({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Renames one group. */
  renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup> {
    return this.dependencies.organizations.renameGroup(input);
  }

  /** Deletes one group, attributed to the caller who asked for it. */
  deleteGroup(
    input: Omit<DeleteOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.deleteGroup({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Adds one member to a group. */
  addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.dependencies.organizations.addGroupMember(input);
  }

  /** Removes one member from a group. */
  removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.dependencies.organizations.removeGroupMember(input);
  }

  /** Adds one access binding to a group, attributed to its caller. */
  addGroupBinding(
    input: Omit<AddOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroupBinding> {
    return this.dependencies.organizations.addGroupBinding({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Removes one access binding from a group, attributed to its caller. */
  removeGroupBinding(
    input: Omit<RemoveOrganizationGroupBindingInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.removeGroupBinding({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** Applies the group editor's whole diff, attributed to its caller. */
  applyGroupEdits(
    input: Omit<ApplyOrganizationGroupEditsInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.dependencies.organizations.applyGroupEdits({
      ...input,
      actor: this.ledgerActor(by),
    });
  }

  /** The display name behind each binding's scope id, one lookup per distinct scope. Lives here
   * rather than in the group transport since resolving ORGANIZATION/TEAM/PROJECT scopes needs
   * both the organization and project services at once, which no single door holds. */
  async resolveBindingScopeNames(input: {
    organizationId: string;
    bindings: readonly OrganizationGroupBinding[];
  }): Promise<Map<string, string>> {
    const { organizationId, bindings } = input;
    const names = new Map<string, string>();
    const uniqueBindings = [
      ...new Map(bindings.map((binding) => [binding.scopeId, binding])).values(),
    ];
    await Promise.all(
      uniqueBindings.map(async (binding) => {
        if (binding.scopeType === "ORGANIZATION") {
          const organization = await this.dependencies.organizations.getBillingProfile({
            organizationId,
          });
          names.set(binding.scopeId, organization.name);
          return;
        }
        if (binding.scopeType === "TEAM") {
          const team = await this.dependencies.organizations.getTeam({
            organizationId,
            teamId: binding.scopeId,
          });
          names.set(binding.scopeId, team.name);
          return;
        }
        const project = await this.dependencies.projects.tryGetById(binding.scopeId);
        if (project) names.set(binding.scopeId, project.name);
      }),
    );
    return names;
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
    return this.dependencies.organizations.getPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  /** Turns every personal-workspace feature on. */
  enableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.dependencies.organizations.enableAllPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  /** Turns every personal-workspace feature off. */
  disableAllPersonalWorkspaceFeatures(
    input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.dependencies.organizations.disableAllPersonalWorkspaceFeatures({
      ...input,
      callerUserId: by.id,
    });
  }

  // -- the projects an organization's teams hold -----------------------------

  /** One project, or null when it does not exist. */
  tryGetProject(id: string): Promise<Project | null> {
    return this.dependencies.projects.tryGetById(id);
  }

  /** The organization's projects, one page at a time. */
  listProjectsByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    return this.dependencies.projects.listByOrganization(input);
  }

  /** The projects that live in one team. */
  listProjectsByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.dependencies.projects.listByTeam(input);
  }
}
