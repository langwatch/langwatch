/**
 * The organization feature's application: what all of its doors call.
 *
 * Four tRPC doors answer for this feature — `organization.*`, `team.*`,
 * `group.*` and the personal-workspace nav predicate — and before this each
 * declared its own private bag of narrowed services: `GroupApplication`,
 * `TeamApplication`, `OrganizationApplication` and an inline
 * `Readonly<{ organizations: … }>`. Four descriptions of one composition,
 * agreeing by attention rather than by construction, and none of them
 * reachable from any other.
 *
 * Most operations are the services' own, reached through {@link organizations}
 * and {@link projects}. What lives here as a method is what a door would
 * otherwise have to know:
 *
 *   - attributing a write to its caller — eight handlers stamped the ledger
 *     actor for themselves, under two different spellings: a `ledgerActor()`
 *     helper in `group.*` and a bare `{ type: "user", id }` literal in
 *     `team.*`;
 *   - resolving a group binding's scope id to the name an admin reads, which
 *     is a rule about what an organization, a team and a project are — not
 *     about tRPC — and which needs both services at once.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
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
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceFeaturesInput,
  RemoveOrganizationGroupBindingInput,
  RemoveOrganizationTeamMemberInput,
  RenameOrganizationGroupInput,
  UpdateOrganizationTeamWithMembersInput,
} from "@langwatch/organization-contract";
import type {
  CustomRole,
  Organization,
  OrganizationIntent,
  OrganizationUser,
  OrganizationUserRole,
  Project as ProjectRow,
  Team,
  TeamUser,
  User,
} from "@langwatch/prisma-client/generated";
import type { PaginatedProjects, Project, ProjectService } from "@langwatch/project-contract";

// ---------------------------------------------------------------------------
// The rows this application hands back
//
// Restated from the same generated Prisma models the composed service reads
// them with (`@langwatch/prisma-client/generated` IS `~/generated/prisma/client`),
// so the shapes a transport publishes are byte-identical to the ones the
// legacy router published.
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

/** One audit-log row, with its actor and its project already resolved. */
type EnrichedAuditLog = {
  id: string;
  createdAt: Date;
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  action: string;
  payload: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  error: string | null;
  args: unknown;
  user: { id: string; name: string | null; email: string | null } | null;
  project: { id: string; name: string } | null;
  source: "platform" | "gateway";
  targetKind: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
};

// ---------------------------------------------------------------------------
// What the process composes this feature's application from
// ---------------------------------------------------------------------------

/**
 * The organization reads and writes this feature makes that the canonical
 * `OrganizationService` contract does not carry.
 *
 * Named structurally rather than picked, because these twelve are the legacy
 * organization surface the app process still owns — membership, invitations,
 * settings and the audit trail — and the contract does not declare them.
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
  updateSettings(input: {
    organizationId: string;
    name: string;
    s3Endpoint: string | null;
    s3AccessKeyId: string | null;
    s3SecretAccessKey: string | null;
    s3Bucket?: string;
    presenceEnabled?: boolean;
    traceSharingEnabled?: boolean;
    supportContact?: string | null;
    primaryIntent?: OrganizationIntent | null;
  }): Promise<void>;
  getOrganizationWithMembers(input: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null>;
  getMemberById(input: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null>;
  getAllMembers(organizationId: string): Promise<User[]>;
  getUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null>;
  getPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null>;
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
 * The twenty-five contract reads and writes this feature makes, named rather
 * than taking `OrganizationService` whole: it is the widest surface in the
 * platform, and an organization screen has no business depending on the parts
 * of it that answer ingestion or billing claims.
 */
type OrganizationContractService = Pick<
  OrganizationService,
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

  /**
   * The ledger actor a write is recorded under.
   *
   * One spelling, in one place. Two doors built this literal for themselves —
   * `group.*` through a `ledgerActor()` helper, `team.*` inline — which is two
   * chances for a write to land unattributed or attributed to the wrong kind.
   */
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

  /**
   * Frees a seat reversibly, attributed to the caller who asked for it.
   *
   * The acting user travels whole rather than as an id: the disable guard
   * identifies the operator by more than their id.
   */
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

  /** Saves the organization settings form. */
  updateSettings(input: Parameters<OrganizationsAppService["updateSettings"]>[0]): Promise<void> {
    return this.dependencies.organizations.updateSettings(input);
  }

  /** One organization with its members and each member's teams. */
  getOrganizationWithMembers(
    input: Omit<Parameters<OrganizationsAppService["getOrganizationWithMembers"]>[0], "userId">,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.dependencies.organizations.getOrganizationWithMembers({
      ...input,
      userId: by.id,
    });
  }

  /** One member, redacted to what the calling member may see. */
  getMemberById(
    input: Omit<Parameters<OrganizationsAppService["getMemberById"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null> {
    return this.dependencies.organizations.getMemberById({ ...input, currentUserId: by.id });
  }

  /** Every member of one organization, for the member pickers. */
  getAllMembers(input: { organizationId: string }): Promise<User[]> {
    return this.dependencies.organizations.getAllMembers(input.organizationId);
  }

  /**
   * The role a user holds in the organization that owns one team.
   *
   * Read by the process's project-protections resolver: someone with no team
   * binding at all may still reach a project through an organization-wide
   * role, and that is the read which says so. Keyed on the TEAM rather than
   * the organization because a project names its team, not its tenant.
   */
  getUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.dependencies.organizations.getUserOrgRoleByTeamId(input);
  }

  /**
   * The organization's declared primary intent (ADR-038), or null where it was
   * never set. The governance setup screen reads it to decide which checklist
   * the organization is being walked through.
   */
  getPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.dependencies.organizations.getPrimaryIntent(organizationId);
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

  /**
   * The display name behind each binding's scope id, one lookup per distinct
   * scope rather than one per binding — a group bound to the same team through
   * several roles would otherwise read the team once for each.
   *
   * It lives here rather than in the group transport because what an
   * `ORGANIZATION`, a `TEAM` and a `PROJECT` scope resolve to is a fact about
   * the domain, and answering it needs both the organization service and the
   * project one at the same time. A door holding only one of them cannot.
   */
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
