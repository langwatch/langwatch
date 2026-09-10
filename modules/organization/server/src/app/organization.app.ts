/**
 * The organization feature's application: what its four tRPC doors (`organization.*`, `team.*`,
 * `group.*`, the personal-workspace nav predicate) call. What lives here is cross-door shared
 * logic; most operations are the services' own, via {@link organizations} and {@link projects}.
 */
import {
  isOrganizationApiCustomRole,
  LiteMemberViewerOnlyError,
  OrganizationApi,
  OrganizationCapabilityUnavailableError,
  OrganizationGroupService,
  OrganizationNotFoundForTeamError,
} from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { UserApi } from "@langwatch/user-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { HandledError } from "@langwatch/handled-error";
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
import { OrganizationService as OrganizationEntityService } from "../services/organization.service.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
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
import type {
  GroupDetail,
  GroupListItem,
  GroupMembershipView,
  TeamWithProjects,
} from "@langwatch/organization-contract";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules.ts";
import { OrganizationGroupScopeService } from "../services/organization-group-scope.service.ts";
import { OrganizationInvitationDoorService } from "../services/organization-invitation-door.service.ts";
import { OrganizationJoinDoorService } from "../services/organization-join-door.service.ts";
import { OrganizationOnboardingService } from "../services/organization-onboarding.service.ts";
import { OrganizationVisibilityService } from "../services/organization-visibility.service.ts";
import {
  PersonalTeamScopeService,
  type PersonalTeamScopeReader,
} from "../services/personal-team-scope.service.ts";
import { isTeamRoleAllowedForOrganizationRole } from "../rules/member-role-constraints.rules.ts";
import type {
  OrganizationCeremony,
  OrganizationDemoProject,
  OrganizationDirectory,
  OrganizationInvitations,
  OrganizationJoinRequests,
  OrganizationPlanGate,
  OrganizationSignals,
} from "./organization.infrastructure.ts";
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
  /** The one permission service every door on this application asks. */
  permissions: AuthzApi;
}

type OrganizationSetup = FeatureSetup<
  { projects: typeof ProjectApi; permissions: typeof AuthzApi; users: typeof UserApi },
  OrganizationInfrastructure,
  undefined,
  OrganizationRepositories
>;

export type OrganizationInfrastructure = Readonly<{
  identities: PersonalWorkspaceIdentityPort;
  teamIdentities: TeamIdentityPort;
  groupIdentities: GroupIdentityPort;
  settingsSecrets: OrganizationSettingsSecretPort;
  diagnostics?: PersonalWorkspaceDiagnosticsPort;
  prompts: OrganizationPromptSeedPort;
  seats: OrganizationSeatLicensePort;
  /** The invitations this deployment administers, or none. */
  invitations: OrganizationInvitations | null;
  /** The join-request ledger, or none. */
  joinRequests: OrganizationJoinRequests | null;
  plans: OrganizationPlanGate;
  signals: OrganizationSignals;
  ceremony: OrganizationCeremony;
  directory: OrganizationDirectory;
  /** The demo organization's person and project, or empty strings when unset. */
  demoProject: OrganizationDemoProject;
}>;

/** The page size the two project lookups read an organization at. */
const TEAM_PROJECT_PAGE = { page: 1, limit: 1_000 } as const;

/** The page size the group list is read at. */
const GROUP_PAGE = { page: 1, limit: 1_000 } as const;

/**
 * The caller may not read this organization's audit trail through the project
 * they filtered it by. Separate from the organization-tier refusal the
 * declaration already made, and the same code, so the customer reads one
 * sentence either way.
 */
class AuditTrailDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to read this audit trail", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "AuditTrailDeniedError";
  }
}

/**
 * A door this deployment composed nothing behind. Every member REJECTS rather
 * than throwing: each one is declared as answering a promise, and a caller
 * that awaits must not have to guard the call itself as well.
 */
function refusing<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get:
        () =>
        (): Promise<never> =>
          Promise.reject(new OrganizationCapabilityUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
}

export class ServerOrganizationApp implements OrganizationApi {
  static readonly contract = OrganizationApi;
  static readonly dependencies = {
    projects: ProjectApi,
    permissions: AuthzApi,
    users: UserApi,
  };
  #dependencies: ServerOrganizationAppDependencies;

  static create(setup: OrganizationSetup): ServerOrganizationApp {
    const organizations = OrganizationEntityService.create({
      repository: setup.repositories.organization,
      teams: setup.repositories.team,
      groups: setup.repositories.group,
      identities: setup.infrastructure.identities,
      teamIdentities: setup.infrastructure.teamIdentities,
      groupIdentities: setup.infrastructure.groupIdentities,
      authz: setup.dependencies.permissions,
      grants: setup.dependencies.permissions,
      settingsSecrets: setup.infrastructure.settingsSecrets,
      diagnostics: setup.infrastructure.diagnostics,
    });
    const membership = OrganizationMembershipService.create({
      repository: setup.repositories.membership(setup.dependencies.permissions),
      prompts: setup.infrastructure.prompts,
      seats: setup.infrastructure.seats,
      sessions: UserApiOrganizationSessionRevocation.create(setup.dependencies.users),
      grantCache: AuthzApiOrganizationGrantCache.create(setup.dependencies.permissions),
    });
    const groups = OrganizationGroupScopeService.create({
      organizations,
      projects: setup.dependencies.projects,
    });
    const application = new ServerOrganizationApp({
      organizations,
      membership,
      groups,
      projects: setup.dependencies.projects,
      permissions: setup.dependencies.permissions,
    });

    application.#infrastructure = setup.infrastructure;
    application.#visibility = OrganizationVisibilityService.create({
      reader: {
        getAllForUser: (input) => membership.getAllForUser(input),
        findOrganizationWithMembers: (input) => membership.findOrganizationWithMembers(input),
        findMemberById: (input) => membership.findMemberById(input),
      },
      permissions: setup.dependencies.permissions,
      secrets: setup.infrastructure.settingsSecrets,
      demoProject: setup.infrastructure.demoProject,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.repositories.personalTeamScope,
    );
    application.#invitationDoor = setup.infrastructure.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: setup.infrastructure.invitations,
          joinRequests: setup.infrastructure.joinRequests,
          plans: setup.infrastructure.plans,
          signals: setup.infrastructure.signals,
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = setup.infrastructure.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: setup.infrastructure.joinRequests,
          directory: setup.infrastructure.directory,
        })
      : null;
    application.#onboarding = OrganizationOnboardingService.create({
      ceremony: setup.infrastructure.ceremony,
      signals: setup.infrastructure.signals,
      createAndAssign: (input, by) => application.createAndAssign(input, by),
      ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
    });

    return application;
  }

  /**
   * Test-only construction over stub services, wired the way `create` wires a
   * booted one: the door services close over the application, so a suite that
   * built it by hand would drive an application whose doors were never attached.
   *
   * Only the infrastructure a suite names is supplied; every other member refuses
   * by name, which is what a deployment that composed none of it does.
   */
  static createForTesting(setup: {
    dependencies: Omit<ServerOrganizationAppDependencies, "groups"> & {
      groups?: OrganizationGroupService;
    };
    infrastructure?: Partial<OrganizationInfrastructure>;
    /** Defaults to a reader that finds no personal team in any scope. */
    personalTeamScope?: PersonalTeamScopeReader;
  }): ServerOrganizationApp {
    const { groups, ...dependencies } = setup.dependencies;
    const application = new ServerOrganizationApp({
      ...dependencies,
      groups:
        groups ??
        OrganizationGroupScopeService.create({
          organizations: dependencies.organizations,
          projects: dependencies.projects,
        }),
    });
    const infrastructure = {
      plans: refusing<OrganizationPlanGate>("organization plan gate"),
      signals: refusing<OrganizationSignals>("organization signals"),
      ceremony: refusing<OrganizationCeremony>("sign-up ceremony"),
      directory: refusing<OrganizationDirectory>("identity directory"),
      settingsSecrets: refusing<OrganizationSettingsSecretPort>("settings cipher"),
      demoProject: { userId: "", projectId: "" },
      invitations: null,
      joinRequests: null,
      ...setup.infrastructure,
    } as OrganizationInfrastructure;

    application.#infrastructure = infrastructure;
    application.#visibility = OrganizationVisibilityService.create({
      reader: {
        getAllForUser: (input) => dependencies.membership.getAllForUser(input),
        findOrganizationWithMembers: (input) =>
          dependencies.membership.findOrganizationWithMembers(input),
        findMemberById: (input) => dependencies.membership.findMemberById(input),
      },
      permissions: dependencies.permissions,
      secrets: infrastructure.settingsSecrets,
      demoProject: infrastructure.demoProject,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.personalTeamScope ?? {
        tryFindPersonalTeamInScopes: async () => null,
        tryFindForeignPersonalTeamInScopes: async () => null,
      },
    );
    application.#invitationDoor = infrastructure.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: infrastructure.invitations,
          joinRequests: infrastructure.joinRequests,
          plans: infrastructure.plans,
          signals: infrastructure.signals,
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = infrastructure.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: infrastructure.joinRequests,
          directory: infrastructure.directory,
        })
      : null;
    application.#onboarding = OrganizationOnboardingService.create({
      ceremony: infrastructure.ceremony,
      signals: infrastructure.signals,
      createAndAssign: (input, by) => application.createAndAssign(input, by),
      ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
    });

    return application;
  }

  private constructor(dependencies: ServerOrganizationAppDependencies) {
    this.#dependencies = dependencies;
  }

  // Assigned once by `create`, immediately after the constructor: the door
  // services close over the application itself, which the constructor cannot
  // hand them.
  #infrastructure!: OrganizationInfrastructure;
  #visibility!: OrganizationVisibilityService;
  #personalTeamScope!: PersonalTeamScopeService;
  #invitationDoor!: OrganizationInvitationDoorService | null;
  #joinDoor!: OrganizationJoinDoorService | null;
  #onboarding!: OrganizationOnboardingService;

  /** The invitation ceremony, or the refusal a deployment without one answers. */
  get #invitations(): OrganizationInvitationDoorService {
    return this.#invitationDoor ?? refusing("organization invitation service");
  }

  /** The join-request ledger, or the refusal a deployment without one answers. */
  get #joinRequests(): OrganizationJoinDoorService {
    return this.#joinDoor ?? refusing("join-request ledger");
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

  findProvisioningSummary(organizationId: string) {
    return this.#dependencies.membership
      .findProvisioningSummary(organizationId)
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
  findOrganizationWithMembers(
    input: Omit<
      Parameters<OrganizationMembershipPort["findOrganizationWithMembers"]>[0],
      "userId"
    >,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.#dependencies.membership.findOrganizationWithMembers({
      ...input,
      userId: by.id,
    });
  }

  /** One member, redacted to what the calling member may see. */
  findMemberById(
    input: Omit<Parameters<OrganizationMembershipPort["findMemberById"]>[0], "currentUserId">,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null> {
    return this.#dependencies.membership.findMemberById({ ...input, currentUserId: by.id });
  }

  /** Every member of one organization, for the member pickers. */
  getAllMembers(input: { organizationId: string }): Promise<User[]> {
    return this.#dependencies.membership.getAllMembers(input.organizationId);
  }

  /** The role a user holds in the organization owning one team — read by the project-protections
   * resolver, since a user with no team binding may still reach a project via an org-wide role. */
  findUserOrgRoleByTeamId(input: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    return this.#dependencies.membership.findUserOrgRoleByTeamId(input);
  }

  /**
   * The organization's declared primary intent (ADR-038), or null where it was
   * never set. The governance setup screen reads it to decide which checklist
   * the organization is being walked through.
   */
  findPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null> {
    return this.#dependencies.membership.findPrimaryIntent(organizationId);
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

  /**
   * Claims the payment provider's customer id for this organization, once.
   * Beside the profile read because they are the same row: the provisioning
   * door reads one and writes the other.
   */
  claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean> {
    return this.#dependencies.organizations.claimBillingCustomerId(input);
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
  findProject(id: string): Promise<Project | null> {
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

  // -- the doors -------------------------------------------------------------
  //
  // What each namespace calls once its transport has stated access. The
  // orchestration below used to live in the transports, where nothing could
  // reach it without a router.

  /** Every organization the caller can reach, redacted for them. */
  listVisibleOrganizations(
    input: Readonly<{ isDemo: boolean }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]> {
    return this.#visibility.listVisible(input, by);
  }

  getOrganizationWithMembersForPicker(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams> {
    return this.#visibility.getWithMembersForPicker(input, by);
  }

  getMemberOrRefuse(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser> {
    return this.#visibility.getMemberOrRefuse(input, by);
  }

  createInvitations(
    input: Parameters<OrganizationInvitationDoorService["create"]>[0],
    by: OrganizationCaller,
  ): ReturnType<OrganizationInvitationDoorService["create"]> {
    return this.#invitations.create(input, by);
  }

  revokeInvitation(input: Readonly<{ organizationId: string; inviteId: string }>): Promise<void> {
    return this.#invitations.revoke(input);
  }

  resendInvitation(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): ReturnType<OrganizationInvitationDoorService["resend"]> {
    return this.#invitations.resend(input);
  }

  listPendingInvitations(
    input: Readonly<{ organizationId: string }>,
  ): ReturnType<OrganizationInvitationDoorService["list"]> {
    return this.#invitations.list(input);
  }

  acceptInvitation(
    input: Readonly<{ inviteCode: string }>,
    by: OrganizationCaller,
  ): ReturnType<OrganizationInvitationDoorService["accept"]> {
    return this.#invitations.accept(input, by);
  }

  /**
   * One team-role change, with three guards ahead of it: a personal team is
   * never role-administered from here, a custom role needs the plan that
   * carries custom roles, and a Lite Member seat allows the Viewer role only.
   */
  async changeTeamMemberRole(
    input: Readonly<{ teamId: string; userId: string; role: string; customRoleId?: string }>,
    by: OrganizationCaller,
  ): Promise<void> {
    await this.#personalTeamScope.assertNoPersonalTeamScope({
      scopes: [{ scopeType: "TEAM", scopeId: input.teamId }],
    });

    const organizationId = await this.#dependencies.organizations.tryGetOrganizationIdByTeamId({
      teamId: input.teamId,
    });
    if (!organizationId) throw new OrganizationNotFoundForTeamError(input.teamId);

    if (isOrganizationApiCustomRole(input.role)) {
      if (input.customRoleId) {
        await this.#infrastructure.plans.assertCustomRolesAllowed({ organizationId });
      }
    } else {
      await this.#assertBuiltInTeamRoleAllowed({ organizationId, input });
    }

    await this.updateTeamMemberRole(input, by);
  }

  /**
   * The audit trail. `auditLog:view` was asked at the organization tier by the
   * declaration; a project FILTER earns the same question at the project tier,
   * so a project-scoped grant cannot widen a read to rows outside it.
   */
  async readAuditLogs(
    input: Parameters<OrganizationMembershipPort["getAuditLogs"]>[0],
    by: OrganizationCaller,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    await this.#infrastructure.plans.assertAuditLogsAllowed({
      organizationId: input.organizationId,
    });

    if (input.projectId) {
      const permitted = await this.#dependencies.permissions.hasPermission({
        userId: by.id,
        permission: "auditLog:view",
        projectId: input.projectId,
      });
      if (!permitted) throw new AuditTrailDeniedError();
    }

    return this.getAuditLogs(input);
  }

  // -- the team doors --------------------------------------------------------

  /** Every team the caller can see, each with the projects that sit in it. */
  async listTeamsWithProjects(
    input: Readonly<{ organizationId: string }>,
    by: OrganizationCaller,
  ): Promise<TeamWithProjects[]> {
    const callerCanManage = await this.#canManage({ organizationId: input.organizationId, by });
    const [teams, projects] = await Promise.all([
      this.listTeamsWithMembers({ organizationId: input.organizationId, callerCanManage }, by),
      this.listProjectsByOrganization({
        organizationId: input.organizationId,
        ...TEAM_PROJECT_PAGE,
      }),
    ]);

    return teams.map((team) => ({
      ...team,
      projects: projects.data.filter((project) => project.teamId === team.id),
    })) as TeamWithProjects[];
  }

  /** The access matrix an administrator edits: who holds what, and through what. */
  async listTeamAccessMatrix(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationTeamAccess[]> {
    const projects = await this.listProjectsByOrganization({
      organizationId: input.organizationId,
      ...TEAM_PROJECT_PAGE,
    });

    return this.listTeamAccess({
      organizationId: input.organizationId,
      projects: projects.data.map(({ id, name, teamId }) => ({ id, name, teamId })),
    });
  }

  async getTeamWithProjects(
    input: Readonly<{ organizationId: string; slug: string }>,
    by: OrganizationCaller,
  ): Promise<TeamWithProjects> {
    const callerCanManage = await this.#canManage({ organizationId: input.organizationId, by });
    const team = await this.getTeamWithMembers({ ...input, callerCanManage }, by);
    const projects = await this.listProjectsByTeam({
      organizationId: input.organizationId,
      teamId: team.id,
    });

    return { ...team, projects } as TeamWithProjects;
  }

  async updateTeamMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    const team = await this.getTeamById({ teamId: input.teamId });
    await this.#assertMemberRolesLicensed({
      organizationId: team.organizationId,
      members: input.members,
    });

    await this.updateTeamWithMembers(input, by);
  }

  async createTeamWithGatedMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    await this.#assertMemberRolesLicensed({
      organizationId: input.organizationId,
      members: input.members,
    });

    return this.createTeamWithMembers(input, by);
  }

  async archiveTeamById(input: Readonly<{ teamId: string }>): Promise<void> {
    const team = await this.getTeamById(input);

    await this.archiveTeam({ teamId: team.id, organizationId: team.organizationId });
  }

  async removeTeamMemberById(
    input: Readonly<{ teamId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<void> {
    const team = await this.getTeamById({ teamId: input.teamId });

    await this.removeTeamMember({ ...input, organizationId: team.organizationId }, by);
  }

  // -- the group doors -------------------------------------------------------

  /** Every group, each binding carrying the scope name an administrator reads. */
  async listGroupsWithScopeNames(
    input: Readonly<{ organizationId: string }>,
  ): Promise<GroupListItem[]> {
    await this.#infrastructure.plans.assertScimAllowed(input);

    const page = await this.listGroups({ ...input, ...GROUP_PAGE });
    const scopeNames = await this.resolveBindingScopeNames({
      organizationId: input.organizationId,
      bindings: page.data.flatMap(({ bindings }) => bindings),
    });

    return page.data.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      memberCount: group.memberCount,
      bindings: group.bindings.map((binding) => ({
        ...binding,
        scopeName: scopeNames.get(binding.scopeId) ?? null,
      })),
      createdAt: group.createdAt,
    })) as GroupListItem[];
  }

  async getGroupWithScopeNames(input: GetOrganizationGroupInput): Promise<GroupDetail> {
    const group = await this.getGroup(input);
    const scopeNames = await this.resolveBindingScopeNames({
      organizationId: input.organizationId,
      bindings: group.bindings,
    });

    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      bindings: group.bindings.map((binding) => ({
        ...binding,
        scopeName: scopeNames.get(binding.scopeId) ?? null,
      })),
      members: group.members,
    } as GroupDetail;
  }

  async createLicensedGroup(
    input: Omit<CreateOrganizationGroupInput, "actor">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup> {
    await this.#infrastructure.plans.assertScimAllowed({ organizationId: input.organizationId });

    return this.createGroup(input, by);
  }

  /** Which groups one person is in, as the member drawer renders them. */
  async listMemberGroupsWithScopeNames(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<GroupMembershipView[]> {
    const groups = await this.listGroupsForMember(input);
    const scopeNames = await this.resolveBindingScopeNames({
      organizationId: input.organizationId,
      bindings: groups.flatMap(({ bindings }) => bindings),
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      scimSource: group.scimSource,
      bindings: group.bindings.map((binding) => ({
        id: binding.id,
        role: binding.role,
        customRoleName: binding.customRoleName,
        scopeType: binding.scopeType,
        scopeName: scopeNames.get(binding.scopeId) ?? binding.scopeId,
      })),
    })) as GroupMembershipView[];
  }

  // -- the join-request doors ------------------------------------------------

  lookupJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown> {
    return this.#joinRequests.lookup(input);
  }

  listOwnJoinRequests(
    input: Readonly<{ userId: string }>,
  ): ReturnType<OrganizationJoinDoorService["listOwn"]> {
    return this.#joinRequests.listOwn(input);
  }

  fileJoinRequest(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): ReturnType<OrganizationJoinDoorService["file"]> {
    return this.#joinRequests.file(input);
  }

  withdrawJoinRequest(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void> {
    return this.#joinRequests.withdraw(input);
  }

  listPendingJoinRequests(
    input: Readonly<{ organizationId: string }>,
  ): ReturnType<OrganizationJoinDoorService["listPending"]> {
    return this.#joinRequests.listPending(input);
  }

  approveJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.#joinRequests.approve(input);
  }

  rejectJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.#joinRequests.reject(input);
  }

  readJoiningPolicy(
    input: Readonly<{ organizationId: string }>,
  ): ReturnType<OrganizationJoinDoorService["readJoining"]> {
    return this.#joinRequests.readJoining(input);
  }

  setJoiningPolicy(
    input: Parameters<OrganizationJoinDoorService["setJoining"]>[0],
  ): ReturnType<OrganizationJoinDoorService["setJoining"]> {
    return this.#joinRequests.setJoining(input);
  }

  // -- the sign-up ceremony --------------------------------------------------

  initializeOrganization(
    input: Parameters<OrganizationOnboardingService["initialize"]>[0],
    by: OrganizationCaller,
  ): ReturnType<OrganizationOnboardingService["initialize"]> {
    return this.#onboarding.initialize(input, by);
  }

  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void {
    this.#onboarding.recordIntegrationMethod(input);
  }

  // -- the personal workspace's own switches, as the door names them ---------

  readPersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.getPersonalWorkspaceFeatures(input, by);
  }

  enablePersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.enableAllPersonalWorkspaceFeatures(input, by);
  }

  disablePersonalWorkspaceFeatures(
    input: Readonly<{ projectId: string }>,
    by: OrganizationCaller,
  ): Promise<PersonalFeatures> {
    return this.disableAllPersonalWorkspaceFeatures(input, by);
  }

  #canManage(input: { organizationId: string; by: OrganizationCaller }): Promise<boolean> {
    return this.#dependencies.permissions.hasPermission({
      userId: input.by.id,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  /** Refuses a member list that assigns a custom role the plan does not carry. */
  async #assertMemberRolesLicensed(input: {
    organizationId: string;
    members: readonly Readonly<{ role: string }>[];
  }): Promise<void> {
    if (!input.members.some((member) => isOrganizationApiCustomRole(member.role))) return;

    await this.#infrastructure.plans.assertCustomRolesAllowed({
      organizationId: input.organizationId,
    });
  }

  /**
   * A Lite Member seat allows the Viewer team role only, and moving one off
   * Viewer costs a full seat. Both are asked here, in that order, because the
   * first is a rule and the second is a licence.
   */
  async #assertBuiltInTeamRoleAllowed(params: {
    organizationId: string;
    input: Readonly<{ teamId: string; userId: string; role: string }>;
  }): Promise<void> {
    const { organizationId, input } = params;
    const organizationRole = await this.#dependencies.membership.findUserOrgRoleByTeamId({
      userId: input.userId,
      teamId: input.teamId,
    });

    if (organizationRole !== "EXTERNAL") return;

    if (
      !isTeamRoleAllowedForOrganizationRole({
        organizationRole: "EXTERNAL",
        teamRole: input.role as TeamRoleValue,
      })
    ) {
      throw new LiteMemberViewerOnlyError();
    }

    await this.#infrastructure.plans.assertTeamRoleChangeWithinSeatLimits({
      organizationId,
      teamId: input.teamId,
      userId: input.userId,
    });
  }

  /** The projects that live in one team. */
  listProjectsByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.#dependencies.projects.listByTeam(input);
  }
}

class UserApiOrganizationSessionRevocation extends OrganizationSessionRevocationPort {
  static create(
    users: UserApi,
  ): UserApiOrganizationSessionRevocation {
    return new UserApiOrganizationSessionRevocation(users);
  }

  private constructor(private readonly users: UserApi) {
    super();
  }

  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.users.revokeAllBrowserSessions(input);
  }
}

class AuthzApiOrganizationGrantCache extends OrganizationGrantCachePort {
  static create(authz: AuthzApi): AuthzApiOrganizationGrantCache {
    return new AuthzApiOrganizationGrantCache(authz);
  }

  private constructor(private readonly authz: AuthzApi) {
    super();
  }

  invalidateOrganization(input: { organizationId: string }): Promise<void> {
    return this.authz.invalidateOrganization(input);
  }
}
