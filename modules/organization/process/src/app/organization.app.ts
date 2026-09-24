import { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  AuthzApi,
  type AuthzListTeamMemberBindingsInput,
  type AuthzTeamMemberBinding,
  type AuthzAccessBreakdownOutput,
  type GrantsLedgerActor,
} from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import type {
  GuidedOnboardingRecord,
  OnboardingInitializeOrganizationInput,
  OrganizationInitialized,
} from "@langwatch/onboarding-contract";
/**
 * The organization feature's application: what its four tRPC doors (`organization.*`, `team.*`,
 * `group.*`, the personal-workspace nav predicate) call. What lives here is cross-door shared
 * logic; most operations are the services' own, via {@link organizations} and {@link projects}.
 */
import {
  AuditTrailDeniedError,
  isOrganizationApiCustomRole,
  LiteMemberViewerOnlyError,
  OrganizationApi,
  OrganizationCapabilityUnavailableError,
  type OrganizationUsageCount,
  type OrganizationApiCreateInvitationsInput,
  type OrganizationInviteCreated,
  type OrganizationApiInviteScope,
  type OrganizationInviteResent,
  type OrganizationListedInvite,
  type OrganizationInviteAccepted,
  type OrganizationPendingInviteApplied,
  type JoinRequestMine,
  type JoinRequestFiled,
  type JoinRequestPending,
  type JoinRequestJoiningChanged,
  type JoinRequestAdmitted,
  type JoinRequestAutomaticJoins,
  type OrganizationProvisioningSummary,
  type OrganizationRestMemberSummary,
  type OrganizationRestMemberTeamBinding,
  type OrganizationSettings,
  type AddOrganizationGroupBindingInput,
  type AddOrganizationTeamMemberInput,
  type ApplyOrganizationGroupEditsInput,
  type ChangeOrganizationGroupMemberInput,
  type CreateOrganizationGroupInput,
  type CreateOrganizationTeamWithMembersInput,
  type CreateOrganizationTeamInput,
  type DeleteOrganizationGroupInput,
  type GetOrganizationBillingProfileInput,
  type GetOrganizationIdByTeamIdInput,
  type GetOrganizationMembersInput,
  type GetOrganizationGroupInput,
  type GetOrganizationTeamByIdInput,
  type GetOrganizationTeamBySlugForMemberInput,
  type GetOrganizationTeamInput,
  type GetOrganizationTeamWithMembersInput,
  type GetOldestTeamInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type ListOrganizationTeamAccessInput,
  type ListOrganizationTeamsWithMembersInput,
  type OrganizationBillingProfile,
  type OrganizationWithAdministrators,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type JoinRequestJoining,
  type OrganizationGroupDetails,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type OrganizationTeam,
  type OrganizationTeamAccess,
  type OrganizationTeamWithMembers,
  type EnrichedAuditLog,
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type PersonalFeatures,
  type PersonalWorkspace,
  type PersonalWorkspaceInput,
  type PersonalWorkspaceFeaturesInput,
  type RemoveOrganizationGroupBindingInput,
  type RemoveOrganizationTeamMemberInput,
  type RenameOrganizationGroupInput,
  type UpdateOrganizationSettingsInput,
  type UpdateOrganizationSettingsResult,
  type UpdateOrganizationTeamInput,
  type UpdateOrganizationTeamWithMembersInput,
  type CustomRole,
  type Organization,
  type OrganizationAdministrator,
  type OrganizationIntent,
  type OrganizationUser,
  type OrganizationUserRole,
  type ProjectRow,
  type Team,
  type TeamUser,
  type User,
  type GroupDetail,
  type GroupListItem,
  type GroupMembershipView,
  type TeamWithProjects,
  type OrganizationMemberProvenance,
  type OrganizationGroupService,
} from "@langwatch/organization-contract";
import type * as organizationContractModule from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi, type PaginatedProjects, type Project } from "@langwatch/project-contract";
import { RoleApi } from "@langwatch/role-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules.ts";
import { isTeamRoleAllowedForOrganizationRole } from "../rules/member-role-constraints.rules.ts";
import type { InviteCreationThrottleService } from "../services/invite-creation-throttle.service.ts";
import { MemberProvenanceService } from "../services/member-provenance.service.ts";
import { OrganizationGroupScopeService } from "../services/organization-group-scope.service.ts";
import { OrganizationInvitationDoorService } from "../services/organization-invitation-door.service.ts";
import { OrganizationJoinDoorService } from "../services/organization-join-door.service.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";
import { OrganizationOnboardingService } from "../services/organization-onboarding.service.ts";
import { OrganizationVisibilityService } from "../services/organization-visibility.service.ts";
import { OrganizationService as OrganizationEntityService } from "../services/organization.service.ts";
import {
  PersonalTeamScopeService,
  type PersonalTeamScopeReader,
} from "../services/personal-team-scope.service.ts";
import type { TeamManagementApi } from "../transport/team.rest.ts";
import { buildOrganizationInfrastructure } from "./organization-composition.build.ts";
import type {
  GroupIdentity,
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
  OrganizationSettingsSecret,
  PersonalWorkspaceDiagnostics,
  PersonalWorkspaceIdentity,
  TeamIdentity,
  OrganizationCeremony,
  OrganizationDemoProject,
  OrganizationDirectory,
  OrganizationInvitations,
  OrganizationJoinRequests,
  OrganizationPlanGate,
  OrganizationSignals,
} from "./organization.members.ts";

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

/** The three project reads an organization screen makes: what lives where. */
type OrganizationProjectApi = ProjectApi;

/** Who a write is attributed to. */
export interface OrganizationCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface ServerOrganizationAppDependencies {
  organizations: OrganizationEntityService;
  membership: OrganizationMembershipService;
  groups: OrganizationGroupService;
  projects: OrganizationProjectApi;
  /** The one permission service every door on this application asks. */
  permissions: AuthzApi;
  /** Revokes trace shares after a settings write turns trace sharing off. */
  shares: ShareApi;
  /** Mints the bootstrap admin service key a provisioned organization needs. */
  apiKeys: ApiKeyApi;
}

/**
 * `publicBaseUrl`/`processName` are the process's own facts. The demo project is `authz`'s: its env
 * leaves have one owner, so this module asks that peer.
 */
type OrganizationMembers = MembersRead<readonly ["prisma", "encryption", "logger", "redis"]> &
  Readonly<{
    publicBaseUrl: string | undefined;
    processName: string;
  }>;

type OrganizationSetup = FeatureSetup<
  typeof ServerOrganizationApp.dependencies,
  OrganizationMembers,
  undefined,
  OrganizationRepositories
>;

export type OrganizationInfrastructure = Readonly<{
  identities: PersonalWorkspaceIdentity;
  teamIdentities: TeamIdentity;
  groupIdentities: GroupIdentity;
  settingsSecrets: OrganizationSettingsSecret;
  diagnostics?: PersonalWorkspaceDiagnostics;
  prompts: OrganizationPromptSeed;
  seats: OrganizationSeatLicense;
  /** The invitations this deployment administers, or none. */
  invitations: OrganizationInvitations | null;
  /**
   * The sender-scoped creation counter the invitation door spends before a
   * batch is written. Travels beside `invitations`: a deployment with the
   * ceremony always has the throttle.
   */
  inviteCreationThrottle: InviteCreationThrottleService;
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
 * A door this deployment composed nothing behind. Every member REJECTS rather
 * than throwing: each one is declared as answering a promise, and a caller
 * that awaits must not have to guard the call itself as well.
 */
function refusing<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => (): Promise<never> =>
        Promise.reject(new OrganizationCapabilityUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
}

/**
 * The organization feature's application: implements {@link OrganizationApi}
 * and {@link TeamManagementApi} explicitly, so a `/api/teams` member this
 * class doesn't serve fails the build instead of throwing at request time.
 */
export class ServerOrganizationApp implements OrganizationApi, TeamManagementApi {
  static readonly contract = OrganizationApi;
  static readonly dependencies = {
    projects: ProjectApi,
    permissions: AuthzApi,
    users: UserApi,
    shares: ShareApi,
    apiKeys: ApiKeyApi,
    /** Identity application that answers for the caller's verified addresses. */
    identity: IdentityApi,
    /**
     * The ONE plan application every allowance in this process is read
     * through: a seat refused here and a seat counted on the usage panel have
     * to be one number.
     */
    entitlement: EntitlementApi,
    /** Where custom-role assignability is defined, for the invitation door. */
    roles: RoleApi,
  };
  /** Named raw: the process answers these two, no store carries them. */
  static readonly reads = [
    ...reads("prisma", "encryption", "logger", "redis"),
    "publicBaseUrl",
    "processName",
  ] as const;
  #dependencies: ServerOrganizationAppDependencies;

  static create(setup: OrganizationSetup): ServerOrganizationApp {
    const members = buildOrganizationInfrastructure({
      prisma: setup.members.prisma,
      encryption: setup.members.encryption,
      logger: setup.members.logger,
      redis: setup.members.redis,
      publicBaseUrl: setup.members.publicBaseUrl,
      processName: setup.members.processName,
      // The peer reference is stored now and called on first read, which is
      // after boot: a peer API refuses while the process is still constructing.
      demoProject: {
        get userId() {
          return setup.dependencies.permissions.demoProject().userId;
        },
        get projectId() {
          return setup.dependencies.permissions.demoProject().projectId;
        },
      },
      dependencies: {
        projects: setup.dependencies.projects,
        identity: setup.dependencies.identity,
        entitlement: setup.dependencies.entitlement,
        permissions: setup.dependencies.permissions,
        roles: setup.dependencies.roles,
      },
    });
    const organizations = OrganizationEntityService.create({
      repository: setup.repositories.organization,
      teams: setup.repositories.team,
      groups: setup.repositories.group,
      identities: members.identities,
      teamIdentities: members.teamIdentities,
      groupIdentities: members.groupIdentities,
      authz: setup.dependencies.permissions,
      grants: setup.dependencies.permissions,
      settingsSecrets: members.settingsSecrets,
      diagnostics: members.diagnostics,
    });
    const membershipRepository = setup.repositories.membership(setup.dependencies.permissions);
    const membership = OrganizationMembershipService.create({
      repository: membershipRepository,
      prompts: members.prompts,
      seats: members.seats,
      sessions: UserApiOrganizationSessionRevocation.create(setup.dependencies.users),
      grantCache: AuthzApiOrganizationGrantCache.create(setup.dependencies.permissions),
      admissions: setup.dependencies.permissions,
      // Resolved per call: the peer API is unreachable while the process constructs.
      testArrivals: {
        standingFor: (args) => setup.dependencies.identity.ssoTestArrival().standingFor(args),
      },
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
      shares: setup.dependencies.shares,
      apiKeys: setup.dependencies.apiKeys,
    });

    application.#members = members;
    application.#memberProvenance = MemberProvenanceService.create({
      members: membershipRepository,
      admissions: {
        findForMembers: (args) => setup.dependencies.identity.joinAdmissions().findForMembers(args),
      },
    });
    application.#visibility = OrganizationVisibilityService.create({
      reader: {
        getAllForUser: (input) => membership.getAllForUser(input),
        findOrganizationWithMembers: (input) => membership.findOrganizationWithMembers(input),
        findMemberById: (input) => membership.findMemberById(input),
      },
      permissions: setup.dependencies.permissions,
      secrets: members.settingsSecrets,
      demoProject: members.demoProject,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.repositories.personalTeamScope,
    );
    application.#invitationDoor = members.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: members.invitations,
          joinRequests: members.joinRequests,
          plans: members.plans,
          signals: members.signals,
          creationThrottle: members.inviteCreationThrottle,
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = members.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: members.joinRequests,
          directory: members.directory,
        })
      : null;
    application.#onboarding = OrganizationOnboardingService.create({
      ceremony: members.ceremony,
      signals: members.signals,
      createAndAssign: (input, by) => application.createAndAssign(input, by),
      ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
    });

    return application;
  }

  /**
   * Test-only construction over stub services, wired the way `create` wires
   * a booted one (door services close over the application). Unnamed
   * members refuse by name, matching an unconfigured deployment.
   */
  static createForTesting(setup: {
    dependencies: Omit<ServerOrganizationAppDependencies, "groups" | "shares" | "apiKeys"> & {
      groups?: OrganizationGroupService;
      shares?: ShareApi;
      apiKeys?: ApiKeyApi;
    };
    members?: Partial<OrganizationInfrastructure>;
    /** Defaults to a reader that finds no personal team in any scope. */
    personalTeamScope?: PersonalTeamScopeReader;
    memberProvenance?: MemberProvenanceService;
  }): ServerOrganizationApp {
    const { groups, shares, apiKeys, ...dependencies } = setup.dependencies;
    const application = new ServerOrganizationApp({
      ...dependencies,
      shares: shares ?? refusing<ShareApi>("trace share revocation"),
      apiKeys: apiKeys ?? refusing<ApiKeyApi>("api key provisioning"),
      groups:
        groups ??
        OrganizationGroupScopeService.create({
          organizations: dependencies.organizations,
          projects: dependencies.projects,
        }),
    });
    const members = {
      plans: refusing<OrganizationPlanGate>("organization plan gate"),
      signals: refusing<OrganizationSignals>("organization signals"),
      ceremony: refusing<OrganizationCeremony>("sign-up ceremony"),
      directory: refusing<OrganizationDirectory>("identity directory"),
      settingsSecrets: refusing<OrganizationSettingsSecret>("settings cipher"),
      demoProject: { userId: "", projectId: "" },
      invitations: null,
      inviteCreationThrottle: refusing<InviteCreationThrottleService>("invite creation throttle"),
      joinRequests: null,
      ...setup.members,
    } as OrganizationInfrastructure;

    application.#members = members;
    application.#memberProvenance =
      setup.memberProvenance ?? refusing<MemberProvenanceService>("member provenance");
    application.#visibility = OrganizationVisibilityService.create({
      reader: {
        getAllForUser: (input) => dependencies.membership.getAllForUser(input),
        findOrganizationWithMembers: (input) =>
          dependencies.membership.findOrganizationWithMembers(input),
        findMemberById: (input) => dependencies.membership.findMemberById(input),
      },
      permissions: dependencies.permissions,
      secrets: members.settingsSecrets,
      demoProject: members.demoProject,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.personalTeamScope ?? {
        findPersonalTeamsInScopes: async () => [],
        findForeignPersonalTeamsInScopes: async () => [],
      },
    );
    application.#invitationDoor = members.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: members.invitations,
          joinRequests: members.joinRequests,
          plans: members.plans,
          signals: members.signals,
          creationThrottle: members.inviteCreationThrottle,
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = members.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: members.joinRequests,
          directory: members.directory,
        })
      : null;
    application.#onboarding = OrganizationOnboardingService.create({
      ceremony: members.ceremony,
      signals: members.signals,
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
  #members!: OrganizationInfrastructure;
  #memberProvenance!: MemberProvenanceService;
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
  }> {
    return this.#dependencies.membership.createAndAssign({ ...input, userId: by.id });
  }

  /** Removes one seat, attributed to the caller who asked for it. */
  deleteMember(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller | null,
  ): Promise<void> {
    return this.#dependencies.membership.deleteMember({ ...input, actingUserId: by?.id ?? null });
  }

  /**
   * Frees a seat reversibly. The acting user travels whole, since the disable guard identifies the
   * operator by more than their id.
   */
  setMemberDisabled(
    input: Readonly<{ organizationId: string; userId: string; disabled: boolean }>,
    by: (OrganizationCaller & { name?: string | null; email?: string | null }) | null,
  ): Promise<void> {
    return this.#dependencies.membership.setMemberDisabled({
      ...input,
      actingUser: by ? { id: by.id, name: by.name ?? null, email: by.email ?? null } : null,
    });
  }

  /**
   * Refuses when this removal would leave the organization without an administrator who can sign
   * in.
   */
  assertRemovalKeepsAnAdministrator(input: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    return this.#dependencies.membership.assertRemovalKeepsAnAdministrator(input);
  }

  /** Every organization the caller can reach, fully loaded. */
  getAllForUser(
    input: Readonly<{ isDemo: boolean; demoProjectUserId: string; demoProjectId: string }>,
    by: OrganizationCaller,
  ): Promise<FullyLoadedOrganization[]> {
    return this.#dependencies.membership.getAllForUser({ ...input, userId: by.id });
  }

  /**
   * Saves the settings form and hands back whether turning trace sharing off means every
   * existing share link now has to be revoked (ADR-057) — only the write saw the stored value
   * beforehand, so the answer is carried through rather than dropped here.
   */
  getJoinSetting(input: { organizationId: string }): Promise<JoinRequestJoining> {
    return this.#dependencies.organizations.getJoinSetting(input);
  }

  saveJoinSetting(input: { organizationId: string; setting: JoinRequestJoining }): Promise<void> {
    return this.#dependencies.organizations.saveJoinSetting(input);
  }

  readGuidedOnboardingState(input: { organizationId: string }): Promise<GuidedOnboardingRecord> {
    return this.#dependencies.organizations.readGuidedOnboardingState(input);
  }

  writeGuidedOnboardingState(input: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord> {
    return this.#dependencies.organizations.writeGuidedOnboardingState(input);
  }

  async updateSettings(
    input: UpdateOrganizationSettingsInput,
  ): Promise<UpdateOrganizationSettingsResult> {
    const result = await this.#dependencies.organizations.updateSettings(input);
    await this.#revokeTraceSharesIfRequired(input.organizationId, result);

    return result;
  }

  /**
   * Trace sharing switched off revokes every share link org-wide — this
   * feature owns neither projects nor shares, so it reaches both peers
   * directly. Loud on purpose: a surviving link is a live leak.
   */
  async #revokeTraceSharesIfRequired(
    organizationId: string,
    result: UpdateOrganizationSettingsResult,
  ): Promise<void> {
    if (!result.traceShareRevocationRequired) return;

    const projectIds = await this.#dependencies.projects.listIdsByOrganization({ organizationId });
    const outcomes = await Promise.allSettled(
      projectIds.map((projectId) => this.#dependencies.shares.revokeAllTraceShares(projectId)),
    );
    const unrevoked = projectIds.filter((_, index) => outcomes[index]?.status === "rejected");

    if (unrevoked.length > 0) {
      throw new Error(
        `Trace sharing was disabled, but share links survive on ${unrevoked.length} project(s): ${unrevoked.join(", ")}`,
      );
    }
  }

  getSettings(input: { organizationId: string }): Promise<OrganizationSettings> {
    return this.#dependencies.organizations.getSettings(input);
  }

  listMembers(input: {
    organizationId: string;
    includeDisabled?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ members: OrganizationRestMemberSummary[]; totalCount: number }> {
    return this.#dependencies.membership.listMembers(input);
  }

  getMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRestMemberSummary & { teams: OrganizationRestMemberTeamBinding[] }> {
    return this.#dependencies.membership.getMember(input);
  }

  createForProvisioning(input: { name: string; slug?: string }): Promise<{
    organization: { id: string; name: string };
    team: { id: string; slug: string; name: string };
  }> {
    return this.#dependencies.membership.createForProvisioning(input);
  }

  listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]> {
    return this.#dependencies.membership.listProvisioningSummaries();
  }

  findProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary | null> {
    return this.#dependencies.membership.findProvisioningSummary(organizationId);
  }

  getMemberAccessBreakdown(
    input: Readonly<{
      organizationId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
    }>,
  ): Promise<AuthzAccessBreakdownOutput> {
    return this.#dependencies.permissions.getAccessBreakdown(input);
  }

  /**
   * Provisions an organization + bootstrap admin key + summary read, for
   * self-hosted admins only. A failure past creation deletes the org
   * (unreachable without its key); the caller sees the ORIGINAL failure.
   */
  async createForProvisioningWithAdminKey(input: {
    name: string;
    slug?: string;
    adminApiKeyName?: string;
  }): Promise<{
    organization: { id: string; name: string; slug: string };
    team: { id: string; slug: string; name: string };
    adminApiKey: { id: string; token: string };
  }> {
    const created = await this.createForProvisioning({
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    });

    try {
      const adminKey = await this.#dependencies.apiKeys.create({
        name: input.adminApiKeyName ?? "Provisioning admin",
        userId: null,
        createdByUserId: null,
        organizationId: created.organization.id,
        permissionMode: "all",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: created.organization.id }],
      });

      const summary = await this.findProvisioningSummary(created.organization.id);
      if (!summary) {
        // The slug is the natural key an members-as-code caller
        // stores; answering success with a blank one moves the failure far
        // from its cause.
        throw new Error(
          `provisioned organization ${created.organization.id} could not be read back`,
        );
      }

      return {
        organization: {
          id: created.organization.id,
          name: created.organization.name,
          slug: summary.slug,
        },
        team: created.team,
        adminApiKey: { id: adminKey.apiKey.id, token: adminKey.token },
      };
    } catch (error) {
      try {
        await this.deleteProvisionedOrganization({ organizationId: created.organization.id });
      } catch (compensationError) {
        this.#members.signals.reportError(
          compensationError instanceof Error
            ? compensationError
            : new Error(String(compensationError)),
        );
      }
      throw error;
    }
  }

  createSelfHostedCustomer(input: { name: string }): Promise<{ id: string; name: string }> {
    return this.#dependencies.membership.createSelfHostedCustomer(input);
  }

  markSelfHostedCustomer(input: { organizationId: string }): Promise<void> {
    return this.#dependencies.membership.markSelfHostedCustomer(input);
  }

  findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]> {
    return this.#dependencies.membership.findSelfHostedCustomers();
  }

  findRepresentatives(input: {
    organizationId: string;
  }): Promise<{ userId: string; organizationName: string }[]> {
    return this.#dependencies.membership.findRepresentatives(input);
  }

  deleteProvisionedOrganization(input: { organizationId: string }): Promise<void> {
    return this.#dependencies.membership.deleteProvisionedOrganization(input);
  }

  createMembership(
    input: Readonly<{
      organizationId: string;
      userId: string;
      admittedBy?: Readonly<{ actor: GrantsLedgerActor; commandId: string }>;
    }>,
  ): Promise<"created" | "already-present"> {
    return this.#dependencies.membership.createMembership(input);
  }

  /**
   * Whether a user is a member of an organization — a door the feature-flag resolver asks on every
   * organization-targeted read, to gate whether the caller may see a flag's answer.
   */
  isMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.#dependencies.organizations.isMember(input);
  }

  /**
   * The batched form of {@link isMember}, for the feature-flag resolver: the workspace switcher
   * asks a flag per listed organization, and this avoids a membership query per row.
   */
  findAllIds(): Promise<string[]> {
    return this.#dependencies.organizations.findAllIds();
  }

  countUsage(input: { organizationIds: readonly string[] }): Promise<OrganizationUsageCount> {
    return this.#dependencies.organizations.countUsage(input);
  }

  memberOrganizationIds(input: { userId: string; organizationIds: string[] }): Promise<string[]> {
    return this.#dependencies.organizations.memberOrganizationIds(input);
  }

  organizationIdsForMember(input: { userId: string }): Promise<string[]> {
    return this.#dependencies.organizations.organizationIdsForMember(input);
  }

  getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]> {
    return this.#dependencies.organizations.getOrganizationMembers(input);
  }

  getOldestTeamId(input: GetOldestTeamInput): Promise<string> {
    return this.#dependencies.organizations.getOldestTeamId(input);
  }

  getOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string> {
    return this.#dependencies.organizations.getOrganizationIdByTeamId(input);
  }

  /** One organization with its members and each member's teams. */
  findOrganizationWithMembers(
    input: Readonly<{ organizationId: string; includeDeactivated: boolean }>,
    by: OrganizationCaller,
  ): Promise<OrganizationWithMembersAndTheirTeams | null> {
    return this.#dependencies.membership.findOrganizationWithMembers({
      ...input,
      userId: by.id,
    });
  }

  /** One member, redacted to what the calling member may see. */
  findMemberById(
    input: Readonly<{ organizationId: string; userId: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationMemberWithUser | null> {
    return this.#dependencies.membership.findMemberById({ ...input, currentUserId: by.id });
  }

  /** Why each member is here, keyed by user id. */
  getMemberProvenance(input: {
    organizationId: string;
  }): Promise<Record<string, OrganizationMemberProvenance>> {
    return this.#memberProvenance.getForOrganization(input);
  }

  /** Every member of one organization, for the member pickers. */
  getAllMembers(input: { organizationId: string }): Promise<User[]> {
    return this.#dependencies.membership.getAllMembers(input.organizationId);
  }

  findMembersIncludingDeactivated(input: { organizationId: string }): Promise<User[]> {
    return this.#dependencies.membership.findMembersIncludingDeactivated(input);
  }

  findMembersWithDepartments(input: { organizationId: string }): Promise<
    {
      userId: string;
      departmentId: string | null;
      user: { name: string | null; email: string | null };
    }[]
  > {
    return this.#dependencies.membership.findMembersWithDepartments(input);
  }

  assignMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.#dependencies.membership.assignMemberDepartment(input);
  }

  findMemberDepartments(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string | null }[]> {
    return this.#dependencies.membership.findMemberDepartments(input);
  }

  findMemberDepartmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<{ userId: string; departmentId: string }[]> {
    return this.#dependencies.membership.findMemberDepartmentsOnDay(input);
  }

  findOpenMemberDepartmentLinks(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]> {
    return this.#dependencies.membership.findOpenMemberDepartmentLinks(input);
  }

  findTeamsWithDepartments(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]> {
    return this.#dependencies.membership.findTeamsWithDepartments(input);
  }

  assignTeamDepartment(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.#dependencies.membership.assignTeamDepartment(input);
  }

  /** Every administrator who can still sign in, named. */
  findAdministrators(input: { organizationId: string }): Promise<OrganizationAdministrator[]> {
    return this.#dependencies.membership.findAdministrators(input);
  }

  /**
   * The role a user holds in the organization owning one team — read by the project-protections
   * resolver, since a user with no team binding may still reach a project via an org-wide role.
   */
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
   * The caller's personal workspace in this organization; `TeamNotFoundError`
   * when they have none. The read half of `ensurePersonalWorkspace` above, for
   * the callers that must not create one as a side effect of asking.
   */
  getPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace>;
  getPersonalWorkspace(
    input: Omit<FindPersonalWorkspaceInput, "userId">,
    by: OrganizationCaller,
  ): Promise<PersonalWorkspace>;
  getPersonalWorkspace(
    input: FindPersonalWorkspaceInput | Omit<FindPersonalWorkspaceInput, "userId">,
    by?: OrganizationCaller,
  ): Promise<PersonalWorkspace> {
    const userId = by?.id ?? ("userId" in input ? input.userId : void 0);
    if (userId === void 0) throw new Error("A user is required to find a personal workspace");
    return this.#dependencies.organizations.getPersonalWorkspace({ ...input, userId });
  }

  /** Changes one member's role inside one team. */
  updateTeamMemberRole(
    input: Readonly<{ teamId: string; userId: string; role: string; customRoleId?: string }>,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.membership.updateTeamMemberRole({
      ...input,
      currentUserId: by.id,
    });
  }

  /** Changes one member's organization role, with its team-role fallout. */
  changeMemberRole(
    input: Readonly<{
      organizationId: string;
      userId: string;
      role: OrganizationUserRole;
      teamRoleUpdates?: { teamId: string; userId: string; role: string; customRoleId?: string }[];
      planUser?: { id: string; name?: string | null; email?: string | null };
    }>,
    by: OrganizationCaller | null,
  ): Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }> {
    return this.#dependencies.membership.changeMemberRole({
      ...input,
      currentUserId: by?.id ?? null,
    });
  }

  /** The organization's audit trail, one page at a time. */
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

  getWithAdministrators(input: {
    organizationId: string;
  }): Promise<OrganizationWithAdministrators> {
    return this.#dependencies.organizations.getWithAdministrators(input);
  }

  updateSentPlanLimitAlert(input: { organizationId: string; sentAt: Instant }): Promise<void> {
    return this.#dependencies.organizations.updateSentPlanLimitAlert(input);
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

  findPersonalTeamOwners(
    input: Readonly<{ organizationId: string; teamIds: readonly string[] }>,
  ): Promise<{ teamId: string; ownerUserId: string | null }[]> {
    return this.#dependencies.organizations.findPersonalTeamOwners(input);
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
    input: organizationContractModule.ListOrganizationTeamsInput,
  ): Promise<organizationContractModule.OrganizationTeamPage> {
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

  /**
   * Renames one team, scoped to the caller credential's organization —
   * never the team's own, which would let one org's token rename another's
   * team. Distinct from `updateTeamWithMembers`, which demands the full diff.
   */
  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.updateTeam(input);
  }

  /** Archives one team. */
  archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.archiveTeam(input);
  }

  /**
   * The bindings that make somebody a member of a team, read through the
   * one permission service this application already holds — not an
   * injected authorization accessor, which no composition supplies.
   */
  listTeamMemberBindings(
    input: AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, AuthzTeamMemberBinding[]>> {
    return this.#dependencies.permissions.listTeamMemberBindings(input);
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
    bindings: readonly organizationContractModule.OrganizationGroupBinding[];
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

  /** Every access binding one group holds. */
  listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupBinding[]> {
    return this.#dependencies.organizations.listGroupBindings(input);
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
    return this.#dependencies.projects.findById(id);
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
    input: OrganizationApiCreateInvitationsInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteCreated[]> {
    return this.#invitations.create(input, by);
  }

  revokeInvitation(input: Readonly<{ organizationId: string; inviteId: string }>): Promise<void> {
    return this.#invitations.revoke(input);
  }

  resendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteResent> {
    return this.#invitations.resend(input);
  }

  listPendingInvitations(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationListedInvite[]> {
    return this.#invitations.list(input);
  }

  acceptInvitation(
    input: Readonly<{ inviteCode: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteAccepted> {
    return this.#invitations.accept(input, by);
  }

  applyPendingInvite(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied> {
    return this.#invitations.applyPending(input);
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

    const organizationId = await this.#dependencies.organizations.getOrganizationIdByTeamId({
      teamId: input.teamId,
    });

    if (isOrganizationApiCustomRole(input.role)) {
      if (input.customRoleId) {
        await this.#members.plans.assertCustomRolesAllowed({ organizationId });
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
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    await this.#members.plans.assertAuditLogsAllowed({
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
    await this.#members.plans.assertScimAllowed(input);

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
    await this.#members.plans.assertScimAllowed({ organizationId: input.organizationId });

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

  listOwnJoinRequests(input: Readonly<{ userId: string }>): Promise<JoinRequestMine> {
    return this.#joinRequests.listOwn(input);
  }

  fileJoinRequest(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<JoinRequestFiled> {
    return this.#joinRequests.file(input);
  }

  withdrawJoinRequest(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void> {
    return this.#joinRequests.withdraw(input);
  }

  listPendingJoinRequests(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestPending> {
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

  readJoiningPolicy(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining> {
    return this.#joinRequests.readJoining(input);
  }

  setJoiningPolicy(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      actorUserId: string;
    }>,
  ): Promise<JoinRequestJoiningChanged> {
    return this.#joinRequests.setJoining(input);
  }

  offerJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown> {
    return this.#joinRequests.offer(input);
  }

  dismissJoinOffer(input: Readonly<{ userId: string }>): Promise<void> {
    return this.#joinRequests.dismissOffer(input);
  }

  admitAutomatically(input: Readonly<{ userId: string }>): Promise<JoinRequestAdmitted> {
    return this.#joinRequests.admitAutomatically(input);
  }

  listAutomaticJoins(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestAutomaticJoins> {
    return this.#joinRequests.listAutomaticJoins(input);
  }

  // -- the sign-up ceremony --------------------------------------------------

  initializeOrganization(
    input: OnboardingInitializeOrganizationInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInitialized> {
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

    await this.#members.plans.assertCustomRolesAllowed({
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

    await this.#members.plans.assertTeamRoleChangeWithinSeatLimits({
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

class UserApiOrganizationSessionRevocation implements OrganizationSessionRevocation {
  static create(users: UserApi): UserApiOrganizationSessionRevocation {
    return new UserApiOrganizationSessionRevocation(users);
  }

  private constructor(private readonly users: UserApi) {}

  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.users.revokeAllBrowserSessions(input);
  }
}

class AuthzApiOrganizationGrantCache implements OrganizationGrantCache {
  static create(authz: AuthzApi): AuthzApiOrganizationGrantCache {
    return new AuthzApiOrganizationGrantCache(authz);
  }

  private constructor(private readonly authz: AuthzApi) {}

  invalidateOrganization(input: { organizationId: string }): Promise<void> {
    return this.authz.invalidateOrganization(input);
  }
}
