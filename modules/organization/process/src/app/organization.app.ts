import { ApiKeyApi } from "@langwatch/api-key-contract";
import { type LedgerActor, SYSTEM_ACTORS } from "@langwatch/authorization";
import {
  AuthzApi,
  type AuthzListTeamMemberBindingsInput,
  type AuthzTeamMemberBinding,
  type AuthzAccessBreakdownOutput,
  type AuthzGrantCaller,
} from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { IdentityApi } from "@langwatch/identity-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
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
  type OrganizationInviteExtended,
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
  type OrganizationUpdatedMember,
  type OrganizationSettings,
  type AddOrganizationGroupGrantInput,
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
  type OrganizationGroupGrant,
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
  type RemoveOrganizationGroupGrantInput,
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
  type OrganizationDirectoryCounts,
  type OrganizationMemberProvenance,
  type OrganizationGroupService,
  type OrganizationFounding,
  type OrganizationMemberSeats,
  type LimitCheckResult,
  type LimitType,
  type ScopeGraphOrganization,
  organizationServerConfig,
  type OrganizationServerConfig,
  type PendingInvitationForCaller,
  type SignUpVerdict,
} from "@langwatch/organization-contract";
import type * as organizationContractModule from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi, type PaginatedProjects, type Project } from "@langwatch/project-contract";
import { RoleApi } from "@langwatch/role-contract";
import { internalSlackSignupsWebhook } from "@langwatch/secrets";
import { ShareApi } from "@langwatch/share-contract";
import type { Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import { organizationInviteMailChannels } from "../channels/organization-invite-mail-channels.registry.ts";
import { signupAnnouncementChannels } from "../channels/signup-announcement-channels.registry.ts";
import {
  buildOrganizationLifecyclePipeline,
  type OrganizationLifecycleDefinition,
} from "../eventing/organization-lifecycle.pipeline.ts";
import type { RecordSeatLimitReachedCommandData } from "../eventing/seat-limit.events.ts";
import {
  buildSeatLimitPipeline,
  type SeatLimitDefinition,
} from "../eventing/seat-limit.pipeline.ts";
import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import { PrismaOrganizationInviteRepository } from "../repositories/prisma/prisma.organization-invite.repository.ts";
import { PrismaOrganizationSeatRepository } from "../repositories/prisma/prisma.organization-seat.repository.ts";
import { PrismaOrganizationUserDirectoryRepository } from "../repositories/prisma/prisma.organization-user-directory.repository.ts";
import { grantCallerOf } from "../rules/grant-caller.rules.ts";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules.ts";
import { isTeamRoleAllowedForOrganizationRole } from "../rules/member-role-constraints.rules.ts";
import { GroupIdentityService } from "../services/group-identity.service.ts";
import type { GroupIdentity } from "../services/group-identity.service.ts";
import { InviteCreationThrottleService } from "../services/invite-creation-throttle.service.ts";
import { InviteSeatCensusService } from "../services/invite-seat-census.service.ts";
import { InviteSendThrottleService } from "../services/invite-send-throttle.service.ts";
import { InviteService } from "../services/invite.service.ts";
import { LicenseLimitService } from "../services/license-limit.service.ts";
import { MemberProvenanceService } from "../services/member-provenance.service.ts";
import { OrganizationCeremonyService } from "../services/organization-ceremony.service.ts";
import type { OrganizationCeremony } from "../services/organization-ceremony.service.ts";
import { OrganizationDirectoryService } from "../services/organization-directory.service.ts";
import type { OrganizationDirectory } from "../services/organization-directory.service.ts";
import { OrganizationGrantCeilingService } from "../services/organization-grant-ceiling.service.ts";
import { OrganizationGroupScopeService } from "../services/organization-group-scope.service.ts";
import { OrganizationInitializationService } from "../services/organization-initialization.service.ts";
import { OrganizationInvitationDoorService } from "../services/organization-invitation-door.service.ts";
import { OrganizationInvitationsService } from "../services/organization-invitations.service.ts";
import type { OrganizationInvitations } from "../services/organization-invitations.service.ts";
import { OrganizationJoinDoorService } from "../services/organization-join-door.service.ts";
import { OrganizationJoinRequestsService } from "../services/organization-join-requests.service.ts";
import type { OrganizationJoinRequests } from "../services/organization-join-requests.service.ts";
import { OrganizationLifecycleNoticeService } from "../services/organization-lifecycle-notice.service.ts";
import type { OrganizationLifecycleSenders } from "../services/organization-lifecycle-notice.service.ts";
import type {
  OrganizationGrantCache,
  OrganizationSessionRevocation,
} from "../services/organization-member-role.service.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";
import { OrganizationPromptSeedService } from "../services/organization-prompt-seed.service.ts";
import type { OrganizationPromptSeed } from "../services/organization-prompt-seed.service.ts";
import {
  OrganizationScopeGraphService,
  type OrganizationScopeGraphReader,
} from "../services/organization-scope-graph.service.ts";
import { OrganizationSeatLicenseService } from "../services/organization-seat-license.service.ts";
import type {
  OrganizationSeatLicense,
  OrganizationPlanUser,
} from "../services/organization-seat-license.service.ts";
import { OrganizationSignalsService } from "../services/organization-signals.service.ts";
import type { OrganizationSignals } from "../services/organization-signals.service.ts";
import { OrganizationVisibilityService } from "../services/organization-visibility.service.ts";
import type { OrganizationDemoProject } from "../services/organization-visibility.service.ts";
import { OrganizationService as OrganizationEntityService } from "../services/organization.service.ts";
import type { OrganizationSettingsSecret } from "../services/organization.service.ts";
import {
  PersonalTeamScopeService,
  type PersonalTeamScopeReader,
} from "../services/personal-team-scope.service.ts";
import { PersonalWorkspaceDiagnosticsService } from "../services/personal-workspace-diagnostics.service.ts";
import type { PersonalWorkspaceDiagnostics } from "../services/personal-workspace-diagnostics.service.ts";
import { PersonalWorkspaceIdentityService } from "../services/personal-workspace-identity.service.ts";
import type { PersonalWorkspaceIdentity } from "../services/personal-workspace-identity.service.ts";
import { SeatLimitNoticeService } from "../services/seat-limit-notice.service.ts";
import { SignUpPolicyService } from "../services/sign-up-policy.service.ts";
import { SignupAnnouncementService } from "../services/signup-announcement.service.ts";
import { TeamIdentityService } from "../services/team-identity.service.ts";
import type { TeamIdentity } from "../services/team-identity.service.ts";
import type { TeamManagementApi } from "../transport/team.rest.ts";

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
  /** The session's address, where the transport read one; the sign-up policy matches it. */
  readonly email?: string | null;
  /** The key a management-API call arrived on; see the contract's OrganizationCaller. */
  readonly apiKeyId?: string | null;
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
 * What the process still hands this module beside its registries: the store client the invitation,
 * seat and user-directory reads are built over, the settings cipher, and the public base URL until
 * its shared leaf lands. The demo project is `authz`'s, asked of that peer.
 */
type OrganizationMembers = MembersRead<readonly ["prisma", "encryption"]> &
  Readonly<{ publicBaseUrl: string | undefined }>;

/** The module's own logger; a part names itself after the colon. */
const logger = createLogger("langwatch:organization");

type OrganizationSetup = FeatureSetup<
  typeof OrganizationModule.dependencies,
  OrganizationMembers,
  OrganizationServerConfig,
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
  /** The full and lite seats an organization holds, as a licence and a plan count them. */
  seatCounts: OrganizationSeatRepository;
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
  signals: OrganizationSignals;
  /** Where a reached seat limit is recorded as this module's event (§9). */
  seatLimits: SeatLimitNoticeService;
  /** Where a sign-up, an invitation batch and an acceptance are recorded (§9). */
  lifecycle: OrganizationLifecycleNoticeService;
  ceremony: OrganizationCeremony;
  directory: OrganizationDirectory;
  /** The demo organization's person and project, or empty strings when unset. */
  demoProject: OrganizationDemoProject;
}>;

/** The page size the two project lookups read an organization at. */
const TEAM_PROJECT_PAGE = { page: 1, limit: 1_000 } as const;

/** What a team read says of one project: its name and address, never its keys. */
function teamProjectOf({ id, name, slug }: { id: string; name: string; slug: string }) {
  return { id, name, slug };
}

/** The page size the group list is read at. */
const GROUP_PAGE = { page: 1, limit: 1_000 } as const;

/**
 * The organization feature's application: implements {@link OrganizationApi}
 * and {@link TeamManagementApi} explicitly, so a `/api/teams` member this
 * class doesn't serve fails the build instead of throwing at request time.
 */
export class OrganizationModule implements OrganizationApi, TeamManagementApi {
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
    /** Sends the invitation mails; notification owns the gateway. */
    notifications: NotificationService,
  };
  /** Named raw: no registry carries these yet (see the members-organization handoff). */
  static readonly reads = ["prisma", "encryption", "publicBaseUrl"] as const;
  /** The sign-up policy's settings (specs/auth/sign-up-restriction.feature). */
  static readonly config = organizationServerConfig;
  /** LangWatch's own sign-ups Slack webhook, shared with billing, auth and identity (ADR-132). */
  static readonly secrets = { internalSlackSignupsWebhook } as const;
  #dependencies: ServerOrganizationAppDependencies;

  static async create(setup: OrganizationSetup): Promise<OrganizationModule> {
    const signupAnnouncements = await setup.secrets.into(
      OrganizationModule.secrets.internalSlackSignupsWebhook,
      (webhookUrl) =>
        SignupAnnouncementService.create({
          channel: webhookUrl ? signupAnnouncementChannels.live.create({ webhookUrl }) : undefined,
          publicBaseUrl: setup.members.publicBaseUrl,
          logger,
        }),
    );
    const infrastructure = OrganizationModule.#composeInfrastructure({
      setup,
      signupAnnouncements,
    });
    const organizations = OrganizationEntityService.create({
      repository: setup.repositories.organization,
      teams: setup.repositories.team,
      groups: setup.repositories.group,
      identities: infrastructure.identities,
      teamIdentities: infrastructure.teamIdentities,
      groupIdentities: infrastructure.groupIdentities,
      authz: setup.dependencies.permissions,
      grants: setup.dependencies.permissions,
      settingsSecrets: infrastructure.settingsSecrets,
      diagnostics: infrastructure.diagnostics,
      notices: infrastructure.lifecycle,
    });
    const membershipRepository = setup.repositories.membership(setup.dependencies.permissions);
    const membership = OrganizationMembershipService.create({
      repository: membershipRepository,
      prompts: infrastructure.prompts,
      seats: infrastructure.seats,
      sessions: UserApiOrganizationSessionRevocation.create(setup.dependencies.users),
      grantCache: AuthzApiOrganizationGrantCache.create(setup.dependencies.permissions),
      admissions: setup.dependencies.permissions,
      ceiling: OrganizationGrantCeilingService.create(setup.dependencies.permissions),
      // Resolved per call: the peer API is unreachable while the process constructs.
      testArrivals: {
        standingFor: (args) => setup.dependencies.identity.ssoTestArrival().standingFor(args),
      },
    });
    const groups = OrganizationGroupScopeService.create({
      organizations,
      projects: setup.dependencies.projects,
    });
    const application = new OrganizationModule({
      organizations,
      membership,
      groups,
      projects: setup.dependencies.projects,
      permissions: setup.dependencies.permissions,
      shares: setup.dependencies.shares,
      apiKeys: setup.dependencies.apiKeys,
    });

    application.#infrastructure = infrastructure;
    application.#licenseLimits = LicenseLimitService.create({
      seats: infrastructure.seats,
      notices: infrastructure.seatLimits,
    });
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
      secrets: infrastructure.settingsSecrets,
      demoProject: infrastructure.demoProject,
    });
    application.#scopeGraph = OrganizationScopeGraphService.create({
      reader: setup.repositories.scopeGraph,
      permissions: setup.dependencies.permissions,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.repositories.personalTeamScope,
    );
    application.#invitationDoor = infrastructure.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: infrastructure.invitations,
          joinRequests: infrastructure.joinRequests,
          signals: infrastructure.signals,
          lifecycle: infrastructure.lifecycle,
          creationThrottle: infrastructure.inviteCreationThrottle,
          ceiling: OrganizationGrantCeilingService.create(setup.dependencies.permissions),
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = infrastructure.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: infrastructure.joinRequests,
          directory: infrastructure.directory,
        })
      : null;
    application.#initialization = OrganizationInitializationService.create({
      ceremony: infrastructure.ceremony,
      signals: infrastructure.signals,
      lifecycle: infrastructure.lifecycle,
      createAndAssign: (input, by) => application.createAndAssign(input, by),
      ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
    });
    application.#signUpPolicy = SignUpPolicyService.create({
      settings: setup.config.signUp,
      repository: setup.repositories.signUpPolicy,
      users: setup.dependencies.users,
      // The addresses accepting an invitation takes; an account identity has not resolved yet
      // answers with none, and the caller's session address stands in.
      findProvenAddresses: async ({ userId }) => {
        const verified = await setup.dependencies.identity.verifiedEmailsOf({ userId });
        return verified.kind === "resolved" ? verified.emails.map((email) => email.value) : [];
      },
    });

    return application;
  }

  /**
   * Test-only construction over stub services, wired the way `create` wires
   * a booted one (door services close over the application). Every collaborator is
   * supplied: a suite names what it leaves unconfigured.
   */
  static createForTesting(setup: {
    dependencies: Omit<ServerOrganizationAppDependencies, "groups"> & {
      groups?: OrganizationGroupService;
    };
    infrastructure: OrganizationInfrastructure;
    /** Defaults to a reader that finds no personal team in any scope. */
    personalTeamScope?: PersonalTeamScopeReader;
    /** Defaults to a reader that finds no organizations. */
    scopeGraph?: OrganizationScopeGraphReader;
    memberProvenance: MemberProvenanceService;
  }): OrganizationModule {
    const { groups, ...dependencies } = setup.dependencies;
    const application = new OrganizationModule({
      ...dependencies,
      groups:
        groups ??
        OrganizationGroupScopeService.create({
          organizations: dependencies.organizations,
          projects: dependencies.projects,
        }),
    });
    const { infrastructure } = setup;

    application.#infrastructure = infrastructure;
    application.#licenseLimits = LicenseLimitService.create({
      seats: infrastructure.seats,
      notices: infrastructure.seatLimits,
    });
    application.#memberProvenance = setup.memberProvenance;
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
    application.#scopeGraph = OrganizationScopeGraphService.create({
      reader: setup.scopeGraph ?? { findScopeGraphForUser: async () => [] },
      permissions: dependencies.permissions,
    });
    application.#personalTeamScope = PersonalTeamScopeService.create(
      setup.personalTeamScope ?? {
        findPersonalTeamsInScopes: async () => [],
        findForeignPersonalTeamsInScopes: async () => [],
      },
    );
    application.#invitationDoor = infrastructure.invitations
      ? OrganizationInvitationDoorService.create({
          invitations: infrastructure.invitations,
          joinRequests: infrastructure.joinRequests,
          signals: infrastructure.signals,
          lifecycle: infrastructure.lifecycle,
          creationThrottle: infrastructure.inviteCreationThrottle,
          ceiling: OrganizationGrantCeilingService.create(dependencies.permissions),
          ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
        })
      : null;
    application.#joinDoor = infrastructure.joinRequests
      ? OrganizationJoinDoorService.create({
          joinRequests: infrastructure.joinRequests,
          directory: infrastructure.directory,
        })
      : null;
    application.#initialization = OrganizationInitializationService.create({
      ceremony: infrastructure.ceremony,
      signals: infrastructure.signals,
      lifecycle: infrastructure.lifecycle,
      createAndAssign: (input, by) => application.createAndAssign(input, by),
      ensurePersonalWorkspace: (input, by) => application.ensurePersonalWorkspace(input, by),
    });

    return application;
  }

  /** The collaborators the doors and services share, built from the setup and its peers. */
  static #composeInfrastructure({
    setup,
    signupAnnouncements,
  }: {
    setup: OrganizationSetup;
    signupAnnouncements: SignupAnnouncementService;
  }): OrganizationInfrastructure {
    const { dependencies } = setup;
    const prisma = setup.members.prisma;
    const baseHost = setup.members.publicBaseUrl ?? "";
    const seatCounts = PrismaOrganizationSeatRepository.create(prisma);
    const userDirectory = PrismaOrganizationUserDirectoryRepository.create(prisma);
    const signals = OrganizationSignalsService.create({ logger, signupAnnouncements });
    const seatLimits = SeatLimitNoticeService.create({ signals });
    const invites = PrismaOrganizationInviteRepository.create({ database: prisma });
    const throttle = InviteSendThrottleService.create(setup.repositories.inviteRateLimit);
    const inviteService = InviteService.create({
      invites,
      seats: InviteSeatCensusService.create(seatCounts),
      plans: dependencies.entitlement,
      grants: dependencies.permissions,
      roles: dependencies.roles,
      throttle,
      baseHost,
      mail: organizationInviteMailChannels.ses.create({
        notifications: dependencies.notifications,
      }),
    });

    return {
      identities: PersonalWorkspaceIdentityService.create(),
      teamIdentities: TeamIdentityService.create(),
      groupIdentities: GroupIdentityService.create(),
      // An organization's stored settings and a project's stored secret are
      // encrypted by ONE algorithm under ONE key: the process's own cipher.
      settingsSecrets: setup.members.encryption,
      diagnostics: PersonalWorkspaceDiagnosticsService.create(logger),
      prompts: OrganizationPromptSeedService.create({ role: setup.role ?? "unknown role", logger }),
      seats: OrganizationSeatLicenseService.create({
        plans: dependencies.entitlement,
        memberships: seatCounts,
        notices: seatLimits,
      }),
      seatCounts,
      invitations: OrganizationInvitationsService.create({
        invites: inviteService,
        repository: invites,
        throttle,
        baseHost,
        identity: dependencies.identity,
        userDirectory,
        notices: seatLimits,
      }),
      // The sender-scoped creation counter spends the same fixed-window
      // repository as the resend throttle, so both invite limits share one counter.
      inviteCreationThrottle: InviteCreationThrottleService.create({
        rateLimit: setup.repositories.inviteRateLimit,
        plans: dependencies.entitlement,
      }),
      // Identity owns the join-request ledger; this feature serves its door.
      joinRequests: OrganizationJoinRequestsService.create(dependencies.identity),
      signals,
      seatLimits,
      lifecycle: OrganizationLifecycleNoticeService.create({
        reportError: (error) => signals.reportError(error),
      }),
      ceremony: OrganizationCeremonyService.create({ projects: dependencies.projects }),
      directory: OrganizationDirectoryService.create({
        identity: dependencies.identity,
        userDirectory,
      }),
      // The peer reference is stored now and called on first read, which is
      // after boot: a peer API refuses while the process is still constructing.
      demoProject: {
        get userId() {
          return dependencies.permissions.demoProject().userId;
        },
        get projectId() {
          return dependencies.permissions.demoProject().projectId;
        },
      },
    };
  }

  private constructor(dependencies: ServerOrganizationAppDependencies) {
    this.#dependencies = dependencies;
  }

  // Assigned once by `create`, immediately after the constructor: the door
  // services close over the application itself, which the constructor cannot
  // hand them.
  #infrastructure!: OrganizationInfrastructure;
  #memberProvenance!: MemberProvenanceService;
  #licenseLimits!: LicenseLimitService;
  /** The peer the worker's seat-limit subscriber tells; absent only in a test's app. */
  #visibility!: OrganizationVisibilityService;
  #scopeGraph!: OrganizationScopeGraphService;
  #personalTeamScope!: PersonalTeamScopeService;
  #invitationDoor!: OrganizationInvitationDoorService | null;
  #joinDoor!: OrganizationJoinDoorService | null;
  #initialization!: OrganizationInitializationService;
  /** Who may sign up and found an organization; absent only in a test's app, which is open. */
  #signUpPolicy: SignUpPolicyService | null = null;

  /** The invitation ceremony; a deployment without one refuses by name. */
  #invitations(): OrganizationInvitationDoorService {
    if (!this.#invitationDoor) {
      throw new OrganizationCapabilityUnavailableError("organization invitation service");
    }
    return this.#invitationDoor;
  }

  /** The join-request ledger; a deployment without one refuses by name. */
  #joinRequests(): OrganizationJoinDoorService {
    if (!this.#joinDoor) throw new OrganizationCapabilityUnavailableError("join-request ledger");
    return this.#joinDoor;
  }

  /** The ledger actor a write is recorded under — one spelling, shared by every door. */
  #ledgerActor(by: OrganizationCaller): { type: "user"; id: string } {
    return { type: "user", id: by.id };
  }

  /** Whose holdings bound what this call may grant: the key it arrived on, else the person. */
  #grantCaller(by: OrganizationCaller): AuthzGrantCaller {
    return grantCallerOf(by);
  }

  // -- the organization, its membership and its invitations ------------------

  /** Sign-up: the caller's first organization and its first team. */
  async createAndAssign(
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
    // On an invite-only installation members join the organizations that invited them;
    // founding one is for instance administrators and the first organization.
    await this.#signUpPolicy?.assertOrganizationCreation({ userId: by.id, email: by.email });

    return this.#dependencies.membership.createAndAssign({ ...input, userId: by.id });
  }

  /** Whether this address may create a new account here. */
  async checkSignUp(input: Readonly<{ email: string }>): Promise<SignUpVerdict> {
    return this.#signUpPolicy?.checkSignUp(input) ?? { allowed: true, via: "open" };
  }

  /** The invitation waiting for a caller who belongs to no organization yet. */
  async getPendingInvitation(by: OrganizationCaller): Promise<PendingInvitationForCaller> {
    return (
      this.#signUpPolicy?.getPendingInvitation({ userId: by.id, email: by.email }) ?? {
        inviteCode: null,
      }
    );
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

  getSessionPolicy(input: { organizationId: string }): Promise<{ maxSessionDurationDays: number }> {
    return this.#dependencies.organizations.getSessionPolicy(input);
  }

  saveSessionPolicy(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void> {
    return this.#dependencies.organizations.saveSessionPolicy(input);
  }

  isInstantEvalsOptedIn(input: { organizationId: string }): Promise<boolean> {
    return this.#dependencies.organizations.isInstantEvalsOptedIn(input);
  }

  recordInstantEvalsOptIn(input: { organizationId: string; userId: string }): Promise<void> {
    return this.#dependencies.organizations.recordInstantEvalsOptIn(input);
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

  /** One member's role or disabled status, changed; the acting user travels whole, as above. */
  updateMember(
    input: Readonly<{
      organizationId: string;
      userId: string;
      role?: OrganizationUserRole;
      disabled?: boolean;
    }>,
    by: (OrganizationCaller & { name?: string | null; email?: string | null }) | null,
  ): Promise<OrganizationUpdatedMember> {
    return this.#dependencies.membership.updateMember({
      ...input,
      actingUser:
        by && by.id !== SYSTEM_ACTORS.managementApi
          ? { id: by.id, name: by.name ?? null, email: by.email ?? null }
          : null,
      caller: by ? this.#grantCaller(by) : { type: "anonymous" },
    });
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

  getProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary> {
    return this.#dependencies.membership.getProvisioningSummary(organizationId);
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
        this.#infrastructure.signals.reportError(
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

  findFoundedBetween(input: {
    fromMs: number;
    toMs: number;
    followUntilMs: number;
  }): Promise<OrganizationFounding[]> {
    return this.#dependencies.membership.findFoundedBetween(input);
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
      admittedBy?: Readonly<{ actor: LedgerActor; commandId: string }>;
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

  findMemberTeamIds(input: { organizationId: string; userId: string }): Promise<string[]> {
    return this.#dependencies.membership.findMemberTeamIds(input);
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
  async updateTeamMemberRole(
    input: Readonly<{ teamId: string; userId: string; role: string; customRoleId?: string }>,
    by: OrganizationCaller,
  ): Promise<void> {
    const team = await this.getTeamById({ teamId: input.teamId });
    return this.#dependencies.membership.updateTeamMemberRole({
      ...input,
      organizationId: team.organizationId,
      currentUserId: by.id,
      caller: this.#grantCaller(by),
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
      // No caller to answer for: nothing is held, so any grant is beyond it.
      caller: by ? this.#grantCaller(by) : { type: "anonymous" },
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
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
    return this.#dependencies.organizations.createTeamWithMembers({
      ...input,
      caller: this.#grantCaller(by),
      actor: this.#ledgerActor(by),
    });
  }

  /** Saves the team settings form's whole diff, attributed to its caller. */
  updateTeamWithMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.updateTeamWithMembers({
      ...input,
      caller: this.#grantCaller(by),
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
    bindings: readonly organizationContractModule.OrganizationGroupGrant[];
  }): Promise<ReadonlyMap<string, string>> {
    return this.#dependencies.groups.resolveBindingScopeNames(input);
  }

  /** Creates a group, attributed to the caller who asked for it. */
  createGroup(
    input: Omit<CreateOrganizationGroupInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup> {
    return this.#dependencies.organizations.createGroup({
      ...input,
      caller: this.#grantCaller(by),
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
  addGroupMember(input: ChangeOrganizationGroupMemberInput, by: OrganizationCaller): Promise<void> {
    return this.#dependencies.organizations.addGroupMember({
      ...input,
      caller: this.#grantCaller(by),
    });
  }

  /** Removes one member from a group. */
  removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    return this.#dependencies.organizations.removeGroupMember(input);
  }

  /** Every access binding one group holds. */
  listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupGrant[]> {
    return this.#dependencies.organizations.listGroupBindings(input);
  }

  /** Adds one access binding to a group, attributed to its caller. */
  addGroupGrant(
    input: Omit<AddOrganizationGroupGrantInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroupGrant> {
    return this.#dependencies.organizations.addGroupGrant({
      ...input,
      caller: this.#grantCaller(by),
      actor: this.#ledgerActor(by),
    });
  }

  /** Removes one access binding from a group, attributed to its caller. */
  removeGroupGrant(
    input: Omit<RemoveOrganizationGroupGrantInput, "actor">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.removeGroupGrant({
      ...input,
      actor: this.#ledgerActor(by),
    });
  }

  /** Applies the group editor's whole diff, attributed to its caller. */
  applyGroupEdits(
    input: Omit<ApplyOrganizationGroupEditsInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#dependencies.organizations.applyGroupEdits({
      ...input,
      caller: this.#grantCaller(by),
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
    includeGovernance?: boolean;
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

  /** The caller's scope graph, narrowed; the host versions it. */
  getScopeGraph(by: OrganizationCaller): Promise<ScopeGraphOrganization[]> {
    return this.#scopeGraph.getScopeGraph(by);
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

  async createInvitations(
    input: OrganizationApiCreateInvitationsInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteCreated[]> {
    return this.#invitations().create(input, by);
  }

  async revokeInvitation(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<void> {
    return this.#invitations().revoke(input);
  }

  async resendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteResent> {
    return this.#invitations().resend(input);
  }

  async extendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteExtended> {
    return this.#invitations().extend(input);
  }

  async listPendingInvitations(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationListedInvite[]> {
    return this.#invitations().list(input);
  }

  async checkInvitesWithinCaller(
    input: Readonly<{
      organizationId: string;
      invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[];
    }>,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#invitations().checkInvitesWithinCaller(input, by);
  }

  async createPaymentPendingInvites(
    input: Readonly<{
      organizationId: string;
      subscriptionId: string;
      invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[];
    }>,
    by: OrganizationCaller,
  ): Promise<void> {
    return this.#invitations().createPaymentPending(input, by);
  }

  async cancelPaymentPendingInvites(
    input: Readonly<{ organizationId: string; subscriptionIds: readonly string[] }>,
  ): Promise<void> {
    return this.#invitations().cancelPaymentPending(input);
  }

  async countMemberSeats(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationMemberSeats> {
    const [fullMembers, liteMembers, developers] = await Promise.all([
      this.#infrastructure.seatCounts.getMemberCount(input.organizationId),
      this.#infrastructure.seatCounts.getMembersLiteCount(input.organizationId),
      this.#infrastructure.seatCounts.getMembersDeveloperCount(input.organizationId),
    ]);
    return { fullMembers, liteMembers, developers };
  }

  /** organization_seat_limit: organization records the fact, billing subscribes (§9). */
  seatLimitPipeline(): SeatLimitDefinition {
    return buildSeatLimitPipeline();
  }

  /** organization_lifecycle: the same in every role, since its peers react from their side (§9). */
  lifecyclePipeline(): OrganizationLifecycleDefinition {
    return buildOrganizationLifecyclePipeline();
  }

  connectLifecycle(senders: OrganizationLifecycleSenders): void {
    this.#infrastructure.lifecycle.connect(senders);
  }

  connectSeatLimit(
    commands: Readonly<{
      recordSeatLimitReached: EventingCommandSender<RecordSeatLimitReachedCommandData>;
    }>,
  ): void {
    this.#infrastructure.seatLimits.connect(commands.recordSeatLimitReached);
  }

  async checkLimit(
    input: Readonly<{ organizationId: string; limitType: LimitType }>,
    by: OrganizationPlanUser,
  ): Promise<LimitCheckResult> {
    return this.#licenseLimits.check(input, by);
  }

  async checkAllLimits(
    input: Readonly<{ organizationId: string }>,
    by: OrganizationPlanUser,
  ): Promise<Record<LimitType, LimitCheckResult>> {
    return this.#licenseLimits.checkAll(input, by);
  }

  async reportLimitBlocked(
    input: Readonly<{ organizationId: string; limitType: LimitType }>,
    by: OrganizationPlanUser,
  ): Promise<void> {
    return this.#licenseLimits.reportBlocked(input, by);
  }

  async approvePaymentPendingInvites(
    input: Readonly<{ subscriptionId: string; organizationId: string }>,
  ): Promise<void> {
    return this.#invitations().approvePaymentPending(input);
  }

  async acceptInvitation(
    input: Readonly<{ inviteCode: string }>,
    by: OrganizationCaller,
  ): Promise<OrganizationInviteAccepted> {
    return this.#invitations().accept(input, by);
  }

  async applyPendingInvite(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied> {
    return this.#invitations().applyPending(input);
  }

  /**
   * One team-role change, with two guards ahead of it: a personal team is
   * never role-administered from here, and a Lite Member seat allows the
   * Viewer role only. The custom-role plan is declared on the door.
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

    if (!isOrganizationApiCustomRole(input.role)) {
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

  /** The Directory's tab badges: each a count, so no tab's list is read to number it. */
  async getDirectoryCounts(
    input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationDirectoryCounts> {
    const { organizationId } = input;
    const [members, invites, requests, groups, teams] = await Promise.all([
      this.listMembers({ organizationId, includeDisabled: true, limit: 1 }),
      this.listPendingInvitations({ organizationId }),
      this.listPendingJoinRequests({ organizationId }),
      this.listGroups({ organizationId, page: 1, limit: 1 }),
      this.listTeams({ organizationId, page: 1, limit: 1 }),
    ]);

    return {
      members: members.totalCount,
      openInvites: invites.filter(
        ({ displayStatus }) => displayStatus === "PENDING" || displayStatus === "EXPIRED",
      ).length,
      joinRequests: requests.length,
      groups: groups.pagination.total,
      teams: teams.pagination.total,
    };
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
      projects: projects.data.filter((project) => project.teamId === team.id).map(teamProjectOf),
    }));
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

    return { ...team, projects: projects.map(teamProjectOf) };
  }

  async updateTeamMembers(
    input: Omit<UpdateOrganizationTeamWithMembersInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<void> {
    await this.updateTeamWithMembers(input, by);
  }

  async createTeamWithGatedMembers(
    input: Omit<CreateOrganizationTeamWithMembersInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<OrganizationTeam> {
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
    const page = await this.listGroups({ ...input, ...GROUP_PAGE });
    const scopeNames = await this.resolveBindingScopeNames({
      organizationId: input.organizationId,
      bindings: page.data.flatMap(({ grants }) => grants),
    });

    return page.data.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      memberCount: group.memberCount,
      grants: group.grants.map((binding) => ({
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
      bindings: group.grants,
    });

    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      externalId: group.externalId,
      scimSource: group.scimSource,
      grants: group.grants.map((binding) => ({
        ...binding,
        scopeName: scopeNames.get(binding.scopeId) ?? null,
      })),
      members: group.members,
    } as GroupDetail;
  }

  async createLicensedGroup(
    input: Omit<CreateOrganizationGroupInput, "actor" | "caller">,
    by: OrganizationCaller,
  ): Promise<OrganizationGroup> {
    return this.createGroup(input, by);
  }

  /** Which groups one person is in, as the member drawer renders them. */
  async listMemberGroupsWithScopeNames(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<GroupMembershipView[]> {
    const groups = await this.listGroupsForMember(input);
    const scopeNames = await this.resolveBindingScopeNames({
      organizationId: input.organizationId,
      bindings: groups.flatMap(({ grants }) => grants),
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      scimSource: group.scimSource,
      grants: group.grants.map((binding) => ({
        id: binding.id,
        role: binding.role,
        customRoleName: binding.customRoleName,
        scopeType: binding.scopeType,
        scopeName: scopeNames.get(binding.scopeId) ?? binding.scopeId,
      })),
    })) as GroupMembershipView[];
  }

  // -- the join-request doors ------------------------------------------------

  async lookupJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown> {
    return this.#joinRequests().lookup(input);
  }

  async listOwnJoinRequests(input: Readonly<{ userId: string }>): Promise<JoinRequestMine> {
    return this.#joinRequests().listOwn(input);
  }

  async fileJoinRequest(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<JoinRequestFiled> {
    return this.#joinRequests().file(input);
  }

  async withdrawJoinRequest(
    input: Readonly<{ joinRequestId: string; userId: string }>,
  ): Promise<void> {
    return this.#joinRequests().withdraw(input);
  }

  async listPendingJoinRequests(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestPending> {
    return this.#joinRequests().listPending(input);
  }

  async approveJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.#joinRequests().approve(input);
  }

  async rejectJoinRequest(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.#joinRequests().reject(input);
  }

  async readJoiningPolicy(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestJoining> {
    return this.#joinRequests().readJoining(input);
  }

  async setJoiningPolicy(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      joinerRole?: JoinRequestJoining["joinerRole"];
      actorUserId: string;
    }>,
  ): Promise<JoinRequestJoiningChanged> {
    return this.#joinRequests().setJoining(input);
  }

  async offerJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown> {
    return this.#joinRequests().offer(input);
  }

  async dismissJoinOffer(input: Readonly<{ userId: string }>): Promise<void> {
    return this.#joinRequests().dismissOffer(input);
  }

  async admitAutomatically(input: Readonly<{ userId: string }>): Promise<JoinRequestAdmitted> {
    return this.#joinRequests().admitAutomatically(input);
  }

  async listAutomaticJoins(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestAutomaticJoins> {
    return this.#joinRequests().listAutomaticJoins(input);
  }

  // -- the sign-up ceremony --------------------------------------------------

  initializeOrganization(
    input: OnboardingInitializeOrganizationInput,
    by: OrganizationCaller,
  ): Promise<OrganizationInitialized> {
    return this.#initialization.initialize(input, by);
  }

  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void {
    this.#initialization.recordIntegrationMethod(input);
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

    await this.#dependencies.membership.assertTeamRoleChangeWithinSeatLimits({
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
