/**
 * `organization.*` — the members of a tenant, their team bindings, its audit trail and
 * its invitations — composed as its own feature. Three groups of answers, and the split
 * is the point.
 */
import type { BrowserSessionApi } from "@langwatch/auth-contract";
import { AuthzApi, type AuthzGrantsService } from "@langwatch/authz-contract";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  MemberClassificationService,
  PrismaUsageMembershipRepository,
  type RoleChangeType,
  type UsageMembershipRepository,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import {
  EmailJoinRequestNotifierAdapter,
  IdentityEventingPort,
  JoinRequestGuardsService,
  JoinRequestLedgerWriterAdapter,
  JoinRequestService,
  JoinRequestsService,
  PostgresIdentityEmailAdapter,
  PrismaJoinCandidateRepository,
  PrismaJoinMembershipRepository,
  PrismaJoinRequestProjectionRepository,
  PrismaJoinRequestReadRepository,
  PrismaJoinSettingRepository,
} from "@langwatch/identity-server";
import { createLogger, type Logger } from "@langwatch/observability";
import { createApp } from "@langwatch/runtime-composition";
import { toDate } from "@langwatch/time";
import type {
  OrganizationApi,
  OrganizationInvite,
  OrganizationListedInvite,
  OrganizationService,
} from "@langwatch/organization-contract";
import {
  buildInviteAcceptUrl,
  PersonalWorkspaceDiagnosticsAdapter,
  resolveInviteDisplayStatus,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
  type OrganizationPlanUser,
  type OrganizationProvisioningPort,
  type OrganizationRestService,
  organizationServer,
  type OrganizationCeremony,
  type OrganizationDemoProject,
  type OrganizationInvitations,
  type OrganizationJoinRequests,
  type OrganizationPlanGate,
  type OrganizationInvitesCreated,
  type OrganizationInviteWithOrganization,
  type OrganizationSignals,
} from "@langwatch/organization-server";
import type { OrganizationUserRole, PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi } from "@langwatch/project-contract";
import type { RoleApi } from "@langwatch/role-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { UserApi } from "@langwatch/user-contract";
import { z } from "zod";

import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import { createOrganizationTrpcRouters } from "./organization-trpc.mount.ts";
import { ApiOrganizationSettingsSecretAdapter } from "../../app/api-organization-settings-secret.adapter.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port.ts";
import type { ApiEnterpriseApplicationPort } from "../enterprise/enterprise.composition.ts";
import type { ComposedOrganizationFeature } from "./organization.composition.types.ts";

/**
 * The questionnaire the sign-up form collects, as the ceremony forwards it. Opaque to the
 * organization package on purpose — the shape is the deployment's — so the schema is
 * declared where the process that reads the answers lives.
 */
export const signUpDataSchema = z.object({}).passthrough();

/**
 * The invitation half of `organization.*`, for a deployment that composed one.
 */
export abstract class ApiOrganizationInvitePort {
  /**
   * Everything the organization application asks the invitation service. The
   * first argument every member takes is the request context the deleted
   * transport used to carry; it is unread, and the next pass drops it.
   */
  abstract readonly ports: ApiOrganizationInvitePorts;
}

/** The eleven answers an invitation service gives this process. */
export type ApiOrganizationInvitePorts = Readonly<{
  createInvites(
    context: never,
    input: Readonly<{ organizationId: string; invites: readonly unknown[] }>,
  ): Promise<OrganizationInvitesCreated>;
  revokeInvite(
    context: never,
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<void>;
  assertInviteSendAllowed(context: never, input: Readonly<{ inviteId: string }>): Promise<void>;
  resendInvite(
    context: never,
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<Readonly<{ invite: OrganizationInvite; emailNotSent: boolean }>>;
  listInvites(
    context: never,
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationListedInvite[]>;
  matchInviteToAcceptor(
    context: never,
    input: Readonly<{ inviteEmail: string; sessionEmail: string; userId: string }>,
  ): Promise<Readonly<{ matches: boolean; viaIdentifierId?: string | null }>>;
  maskInvitedAddress(email: string): string;
  applyInvite(
    context: never,
    input: Readonly<{
      userId: string;
      invite: OrganizationInviteWithOrganization;
      viaIdentifierId?: string | null;
    }>,
  ): Promise<void>;
  tryFindLandingProjectSlug(
    context: never,
    input: Readonly<{ invite: OrganizationInviteWithOrganization }>,
  ): Promise<string | null>;
  resolveJoinRequestByInvitation(
    context: never,
    input: Readonly<{ userId: string; organizationId: string; inviteId: string }>,
  ): Promise<void>;
  withdrawJoinRequestOnInvitationAccepted(
    context: never,
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<void>;
}>;

/** The other services and deployment facts `organization.*` reaches. */
export type OrganizationPeers = Readonly<{
  /**
   * The grant ledger an accepted invitation's role bindings are written
   * through. Absent, the invitation half is not composed here and the
   * injected port — or the refusal — stands.
   */
  authzGrants?: AuthzGrantsService | undefined;
  /**
   * The SAME role service `role.*` and `roleBinding.*` mount. An invitation
   * validated against a second copy of assignability would be accepted on
   * write and silently dropped on acceptance.
   */
  roles?: RoleApi | undefined;
  /** The deployment's cipher, for the organization's stored settings. */
  encryption: SecretEncryptionPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** The invitation service, where the deployment composed one. */
  invites?: ApiOrganizationInvitePort | undefined;
  /**
   * The membership graph the four tenant-shaped namespaces are served over, where this
   * process composed one.
   */
  membership?: OrganizationMembershipPeers | undefined;
}>;

/** What the membership half of this feature is composed over. */
export type OrganizationMembershipPeers = Readonly<{
  /** The same organization service the REST doors and the AuthZ graph serve from. */
  organizations: OrganizationService;
  /** The project application this process installed, one graph for every door. */
  projects: ProjectApi;
  /**
   * The one authorization application this process serves every decision from.
   * The module's own doors ask it directly now: the redaction in
   * `organization.getAll` and the two member reads are permission questions,
   * and a second copy of the answer would redact differently.
   */
  permissions: AuthzApi;
  /** The grant ledger every membership write states its access on. */
  grants: AuthzGrantsService;
  /** The Auth service a disabled membership's browser sessions are revoked through. */
  auth: BrowserSessionApi;
  /**
   * The signed-in person's application, for the personal workspace the sign-up
   * ceremony provisions. The SAME one `user.*` answers from: a second would
   * provision a workspace for somebody the /me screens do not know.
   */
  users: Pick<UserApi, "ensurePersonalWorkspace">;
  /** The event stack the join-request ledger appends and stages through. */
  eventing: IdentityEventingPort;
  /** The messages this half sends, where the deployment composed a gateway. */
  mail?: ApiPersonMailPort | undefined;
  /** Names this process in every refusal the membership half raises. */
  processName: string;
}>;


/** Installs the six organization surfaces over this process's own graph. */
export async function installApiOrganization(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: OrganizationPeers;
  /**
   * The process's ONE fixed-window counter. The same instance every other throttle on
   * this process meters through: two limiters would give one caller two budgets, which is
   * the whole reason the production composition holds a single one.
   */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** This deployment's public origin, for the invitation links it mints. */
  baseHost: string;
  /** The demo project every caller may read, where a deployment names one. */
  demoProject: Readonly<{ userId: string; projectId: string }>;
}): Promise<ComposedOrganizationFeature> {
  const logger = createLogger("langwatch:api:organization");

  if (!options.peers.membership) return refusingOrganizationFeature();

  const membership = await composeMembershipHalf({
    prisma: options.infrastructure.prisma,
    plans: options.infrastructure.plans,
    peers: options.peers.membership,
    invites: options.peers.invites,
    enterprise: options.peers.enterprise,
    rateLimit: (input) => options.rateLimit(input),
    logger,
    encryption: options.peers.encryption,
    baseHost: options.baseHost,
    demoProject: options.demoProject,
  });

  return {
    app: membership.app,
    rest: membership.rest,
    provisioning: membership.provisioning,
    routers: (mount) => createOrganizationRouters(mount),
  };
}

/**
 * `organization.*` on a process that composed no graph to administer. The namespace still
 * mounts and every call refuses by name, so an administrator is told the deployment
 * cannot answer rather than shown an organization with no members in it.
 */
export function refusingOrganizationFeature(): ComposedOrganizationFeature {
  return {
    app: refusingServerOrganizationApp(),
    rest: undefined,
    provisioning: undefined,
    // The six namespaces mount either way, so a client's inferred types never
    // depend on the deployment shape; every call then refuses by name instead
    // of showing an organization with nobody in it.
    routers: (mount) => createOrganizationRouters(mount),
  };
}

/** A capability this deployment did not compose, refused by name. */
export class ApiOrganizationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
      // The capability itself, because the wire message is the CODE (#5984):
      // without it a customer's failure is traceable to "something is off"
      // rather than to the deployment shape that caused it.
      meta: { capability },
    });
    this.name = "ApiOrganizationUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// The membership half: seats, groups, join requests and the sign-up ceremony
// ---------------------------------------------------------------------------

/** Everything the membership half composed, ready to mount. */
type OrganizationMembership = Readonly<{
  app: OrganizationApi;
  rest: OrganizationRestService;
  provisioning: OrganizationProvisioningPort &
    Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId">;
}>;

/**
 * Composes the membership half over this process's own graph. The organization service,
 * the project service, the grant ledger and the user directory all arrive already
 * composed.
 */
async function composeMembershipHalf(options: {
  prisma: PrismaClient;
  plans: Pick<PlanProvider, "getActivePlan">;
  peers: OrganizationMembershipPeers;
  /** The invitation service, where the deployment composed one. */
  invites: ApiOrganizationInvitePort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise: ApiEnterpriseApplicationPort | undefined;
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  logger: Logger;
  encryption: SecretEncryptionPort;
  /** This deployment's public origin, for a lapsed requester's personal project link. */
  baseHost: string;
  /** The demo project every caller may read, where a deployment names one. */
  demoProject: OrganizationDemoProject;
}): Promise<OrganizationMembership> {
  const { prisma, plans, peers, logger, baseHost, encryption } = options;
  const { projects, grants, users, eventing, mail, processName } = peers;
  const unavailable = (capability: string) => new ApiOrganizationUnavailableError(capability);

  const prompts = LoggedApiOrganizationPromptSeed.create({ processName, logger });
  const seats = ApiOrganizationSeatLicense.create({
    plans,
    memberships: PrismaUsageMembershipRepository.create(prisma),
  });
  const identityEmails = PostgresIdentityEmailAdapter.create({ database: prisma }).build();

  function notifyNothing(what: string): void {
    logger.warn(
      { processName },
      `${processName} composes no mail gateway, so nobody was told that ${what}.`,
    );
  }

  const joinRequests = JoinRequestsService.create({
    requests: JoinRequestService.create(
      JoinRequestGuardsService.create({ requests: new PrismaJoinRequestReadRepository(prisma) }),
      JoinRequestLedgerWriterAdapter.create({
        projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
        eventing,
      }),
    ),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: PrismaJoinMembershipRepository.create(prisma, grants),
    notifier: mail
      ? EmailJoinRequestNotifierAdapter.create({
          prisma,
          mail,
          baseHost,
          plans,
          memberships: PrismaUsageMembershipRepository.create(prisma),
        })
      : {
          // Fire-and-forget by construction: a request that could not be
          // announced is still recorded, and the admin finds it on the members
          // page. Logged rather than refused so nobody is blocked from asking.
          requestArrived: async () => notifyNothing("a join request arrived"),
          requestStillWaiting: async () => notifyNothing("a join request is still waiting"),
          requestApproved: async () => notifyNothing("a join request was approved"),
          requestRejected: async () => notifyNothing("a join request was rejected"),
          requestExpired: async () => notifyNothing("a join request expired"),
          joinedAutomatically: async () => notifyNothing("somebody joined automatically"),
        },
    settings: PrismaJoinSettingRepository.create(prisma),
    // The licence asymmetry, stated once: the gate that has always held single
    // sign-on holds AUTOMATIC joining, because that is federation. This process
    // holds no licence gate, so automatic joining is denied and ASKING is not —
    // which is exactly the shape that keeps "my company is invisible" fixed on
    // the deployments that have no other way out.
    autoJoinLicensed: () => Promise.resolve(false),
    // No feature-flag service on this half, and the flag is a rollout control
    // rather than an entitlement: the surface is mounted, so it is on.
    enabled: () => Promise.resolve(true),
    rateLimit: (input) => options.rateLimit(input),
  });

  /**
   * The caller's own verified address, and the reason every requester-side join-request
   * procedure starts here.
   */
  const verifiedEmailFor = async ({ userId }: { userId: string }): Promise<string | null> => {
    const verified = await identityEmails.tryVerifiedEmailsOf({ userId });
    if (verified !== null) return verified[0]?.value ?? null;
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    return row?.emailVerified ? (row.email ?? null) : null;
  };

  /**
   * The display names a pending list renders. Names only: the local part of a
   * requester's address is not the organization's business until they are a
   * member of it.
   */
  const listUserNames = ({ userIds }: { userIds: readonly string[] }) =>
    prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(ProjectApi, projects)
    .withProvided(AuthzApi, peers.permissions)
    .withProvided(UserApi, users as UserApi)
    .withModule(organizationServer, {
      infrastructure: {
        identities: PersonalWorkspaceIdentityAdapter.create(),
        teamIdentities: TeamIdentityAdapter.create(),
        groupIdentities: GroupIdentityAdapter.create(),
        settingsSecrets: ApiOrganizationSettingsSecretAdapter.create({ encryption }),
        diagnostics: PersonalWorkspaceDiagnosticsAdapter.create(logger),
        prompts,
        seats,
        invitations: apiOrganizationInvitations({
          invites: options.invites,
          prisma,
          baseHost: options.baseHost,
          enterprise: options.enterprise,
          logger,
        }),
        joinRequests: apiOrganizationJoinRequests({ joinRequests, invites: options.invites }),
        plans: apiOrganizationPlanGate({ plans, unavailable }),
        signals: apiOrganizationSignals(logger),
        ceremony: apiOrganizationCeremony({ projects, unavailable }),
        directory: { findVerifiedEmail: verifiedEmailFor, listUserNames },
        demoProject: options.demoProject,
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(organizationServer).provided;
  const rest: OrganizationRestService = {
    getSettings: (input) => app.getSettings(input),
    updateSettings: (input) => app.updateSettings(input),
    listMembers: async (input) => {
      const result = await app.listMembers(input);
      return {
        ...result,
        members: result.members.map((member) => ({
          ...member,
          disabledAt: member.disabledAt === null ? null : toDate(member.disabledAt),
          createdAt: toDate(member.createdAt),
          updatedAt: toDate(member.updatedAt),
        })),
      };
    },
    getMember: async (input) => {
      const member = await app.getMember(input);
      return {
        ...member,
        disabledAt: member.disabledAt === null ? null : toDate(member.disabledAt),
        createdAt: toDate(member.createdAt),
        updatedAt: toDate(member.updatedAt),
      };
    },
    changeMemberRole: (input, by) => app.changeMemberRole(input, by),
    setMemberDisabled: (input, by) => app.setMemberDisabled(input, by),
    deleteMember: (input, by) => app.deleteMember(input, by),
  };
  const provisioning: OrganizationProvisioningPort &
    Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId"> = {
    createForProvisioning: (input) => app.createForProvisioning(input),
    deleteProvisionedOrganization: (input) => app.deleteProvisionedOrganization(input),
    getBillingProfile: (input) => app.getBillingProfile(input),
    claimBillingCustomerId: (input) => app.claimBillingCustomerId(input),
    listProvisioningSummaries: async () =>
      (await app.listProvisioningSummaries()).map((summary) => ({
        ...summary,
        createdAt: toDate(summary.createdAt),
      })),
    findProvisioningSummary: async (organizationId) => {
      const summary = await app.findProvisioningSummary(organizationId);
      return summary === null ? null : { ...summary, createdAt: toDate(summary.createdAt) };
    },
  };

  return {
    app,
    // The SAME merged object the application reads, published so the
    // management REST family serves from it too. A second service over the
    // same rows would let `/api/organization/members` and the members screen
    // disagree about who is in an organization.
    rest,
    provisioning,
  };
}

// ---------------------------------------------------------------------------
// The process capabilities the organization module is composed over
// ---------------------------------------------------------------------------

/** Mounts the module's six namespaces on this process's tRPC runtime. */
function createOrganizationRouters(mount: ApiTrpcFeatureMount) {
  return createOrganizationTrpcRouters(mount.runtime);
}

/**
 * The invitations this deployment administers. The SAME service the management
 * REST family serves from, so an administrator and a provisioning tool see one
 * set of invitations with one acceptance link each. A deployment that composed
 * none gets `null`, and the application refuses each invitation door by name.
 */
function apiOrganizationInvitations(options: {
  invites: ApiOrganizationInvitePort | undefined;
  prisma: PrismaClient;
  baseHost: string;
  enterprise: ApiEnterpriseApplicationPort | undefined;
  logger: Logger;
}): OrganizationInvitations | null {
  const invites = options.invites;
  if (!invites) return null;

  const ports = invites.ports;

  return {
    create: (input) => ports.createInvites(undefined as never, input as never) as never,
    revoke: (input) => ports.revokeInvite(undefined as never, input),
    assertSendAllowed: (input) => ports.assertInviteSendAllowed(undefined as never, input),
    resend: (input) => ports.resendInvite(undefined as never, input),
    list: (input) => ports.listInvites(undefined as never, input) as never,
    /**
     * A row read, so it is answered here rather than behind the injected
     * service: the code in the link addresses one invitation, and reading it is
     * what tells a signed-in person which organization they were asked to join.
     */
    findByCode: ({ inviteCode }) =>
      options.prisma.organizationInvite.findUnique({
        where: { inviteCode },
        include: { organization: true },
      }) as never,
    matchToAcceptor: (input) => ports.matchInviteToAcceptor(undefined as never, input),
    apply: (input) => ports.applyInvite(undefined as never, input as never),
    findLandingProjectSlug: (input) =>
      ports.tryFindLandingProjectSlug(undefined as never, input as never),
    acceptUrl: (inviteCode) => buildInviteAcceptUrl(options.baseHost, inviteCode),
    maskAddress: (email) => ports.maskInvitedAddress(email),
    displayStatus: (invite) => resolveInviteDisplayStatus(invite as never),
    notifySeatLimitReached: async (input) => {
      const usageLimits = options.enterprise?.usageLimits;
      if (!usageLimits) {
        options.logger.debug(
          { organizationId: input.organizationId, limitType: input.limitType },
          "no Enterprise usage-limit store is composed: the seat-limit notification for this organization is not sent",
        );
        return;
      }
      await usageLimits.notifyResourceLimitReached(input as never);
    },
    findUserIdByEmail: async ({ email }) => {
      const row = await options.prisma.user.findFirst({ where: { email }, select: { id: true } });
      return row?.id ?? null;
    },
  };
}

/**
 * Asking to join, and answering. The two invitation-side tidies go through the
 * SAME invitation service, because it is the one that knows which request an
 * invitation answers.
 */
function apiOrganizationJoinRequests(options: {
  joinRequests: JoinRequestsService;
  invites: ApiOrganizationInvitePort | undefined;
}): OrganizationJoinRequests {
  const { joinRequests, invites } = options;
  const unavailable = (): Promise<never> =>
    Promise.reject(new ApiOrganizationUnavailableError("organization invitation service"));

  return {
    lookup: (input) => joinRequests.lookup(input),
    pendingForUser: (input) => joinRequests.pendingForUser(input),
    pendingForOrganization: (input) => joinRequests.pendingForOrganization(input),
    request: (input) => joinRequests.request(input),
    withdraw: (input) => joinRequests.withdraw(input),
    approve: (input) => joinRequests.approve(input),
    reject: (input) => joinRequests.reject(input),
    readJoining: (input) => joinRequests.readJoining(input),
    setJoining: (input) => joinRequests.setJoining({ ...input, domains: [...input.domains] }),
    resolveByInvitation: (input) =>
      invites
        ? invites.ports.resolveJoinRequestByInvitation(undefined as never, input)
        : unavailable(),
    withdrawOnInvitationAccepted: (input) =>
      invites
        ? invites.ports.withdrawJoinRequestOnInvitationAccepted(undefined as never, input)
        : unavailable(),
  };
}

/**
 * Both Enterprise plan gates, over the ONE plan provider this process resolves
 * every allowance through. SCIM and the seat guard are read out of stores this
 * process does not hold, so both refuse by name.
 */
function apiOrganizationPlanGate(options: {
  plans: Pick<PlanProvider, "getActivePlan">;
  unavailable(capability: string): ApiOrganizationUnavailableError;
}): OrganizationPlanGate {
  const assertPlan = async (organizationId: string, errorMessage: string) => {
    const plan = await options.plans.getActivePlan({ organizationId } as never);
    assertEnterprisePlanType({ planType: plan.type, errorMessage });
  };

  return {
    assertCustomRolesAllowed: ({ organizationId }) =>
      assertPlan(organizationId, ENTERPRISE_FEATURE_ERRORS.RBAC),
    assertAuditLogsAllowed: ({ organizationId }) =>
      assertPlan(organizationId, ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS),
    assertScimAllowed: () =>
      Promise.reject(
        options.unavailable(
          "Enterprise plan store, so it cannot confirm this organization carries SCIM",
        ),
      ),
    assertTeamRoleChangeWithinSeatLimits: () =>
      Promise.reject(
        options.unavailable("Enterprise seat licence, so it cannot authorize a member role change"),
      ),
  };
}

/**
 * The trail a sign-up, an invitation and a chosen integration leave outside
 * this feature. This process composes no product-analytics sink and no
 * marketing gateway, so each one says so once, at debug, and carries on.
 */
function apiOrganizationSignals(logger: Logger): OrganizationSignals {
  const unsent = (what: string) =>
    logger.debug(
      { signal: what },
      `no product-analytics sink is composed: ${what} is not recorded`,
    );

  return {
    trackServerEvent: (input) => unsent(`the organization event "${input.event}"`),
    fireTeamMemberInvitedNurturing: () => unsent("a team member being invited"),
    fireInviteAcceptedNurturing: () => unsent("an invitation being accepted"),
    fireSignupNurturing: () => unsent("somebody signing up"),
    sendSlackSignupEvent: async () => unsent("a sign-up announcement"),
    sendHubspotSignupForm: async () => unsent("a sign-up form"),
    recordIntegrationMethod: () => unsent("a chosen integration method"),
    reportError: (error) => {
      logger.error({ error }, "an organization surface failed");
    },
  };
}

/**
 * The parts of the sign-up ceremony that belong to other features. The first
 * project goes through the project application this process composed rather
 * than a second creation path, so it writes the same rows the project surface
 * writes.
 */
function apiOrganizationCeremony(options: {
  projects: ProjectApi;
  unavailable(capability: string): ApiOrganizationUnavailableError;
}): OrganizationCeremony {
  return {
    /**
     * The standard AI-tool catalogue is an Enterprise governance capability.
     * Non-fatal at the call site - the portal's own read provisions the same
     * set - so this refuses by name and the ceremony carries on.
     */
    ensureDefaultAiToolCatalog: () =>
      Promise.reject(
        options.unavailable(
          "Enterprise governance service, so it seeded no standard AI tool catalogue",
        ),
      ),
    createProject: async (input) => {
      const project = await options.projects.create(
        {
          organizationId: input.organizationId,
          teamId: input.teamId,
          name: input.name,
          language: input.language,
          framework: input.framework,
        },
        { id: input.userId },
      );

      return { success: true, projectSlug: project.slug };
    },
  };
}

/** The `ctx.app.organizations` slice on a process with no membership graph. */
function refusingServerOrganizationApp(): OrganizationApi {
  return new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiOrganizationUnavailableError("organization directory");
      },
      has: () => true,
    },
  ) as OrganizationApi;
}

/** A seat decision with every field answered. */
export type ApiOrganizationSeatAnswer = Readonly<{
  allowed: boolean;
  limitType: "members" | "membersLite";
  current: number;
  max: number;
}>;

/**
 * The seat licence, over the SAME plan provider and the SAME membership counts every
 * other allowance in this process reads.
 */
export class ApiOrganizationSeatLicense extends OrganizationSeatLicensePort {
  static create(options: {
    plans: Pick<PlanProvider, "getActivePlan">;
    memberships: UsageMembershipRepository;
  }): ApiOrganizationSeatLicense {
    return new ApiOrganizationSeatLicense(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<PlanProvider, "getActivePlan">;
      memberships: UsageMembershipRepository;
    },
  ) {
    super();
  }

  /**
   * Narrower than the port on purpose: every field is answered, always. The port leaves
   * `limitType`, `current` and `max` optional so a deployment with no seat gate can refuse with
   * `allowed` alone, and the licence-enforcement door needs all four to render a limit.
   */
  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<ApiOrganizationSeatAnswer> {
    const plan = await this.activePlan(input.organizationId, input.user);
    const max = this.allowance(plan, input.resource);
    if (plan.overrideAddingLimitations) {
      return { allowed: true, limitType: input.resource, current: 0, max };
    }

    const current = await this.seatsTaken(input.organizationId, input.resource);
    return { allowed: current < max, limitType: input.resource, current, max };
  }

  async assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    teamRoleUpdates?: ReadonlyArray<{ role: string; customRoleId?: string }> | undefined;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void> {
    const plan = await this.activePlan(input.organizationId, input.user);
    // The NEW role's permissions are deliberately not read: a built-in role
    // carries none, and a custom one is gated below on the plan rather than on
    // a seat. That is the platform's own call, kept.
    const change = MemberClassificationService.getRoleChangeType(
      input.currentRole as OrganizationUserRole,
      input.userPermissions,
      input.role as OrganizationUserRole,
      undefined,
    );
    await this.assertSeatForChange({
      change,
      organizationId: input.organizationId,
      plan,
    });

    const assignsCustomRole = (input.teamRoleUpdates ?? []).some(
      (update) => Boolean(update.customRoleId) || isCustomRole(update.role),
    );
    if (assignsCustomRole) {
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    }
  }

  private async assertSeatForChange(input: {
    change: RoleChangeType;
    organizationId: string;
    plan: PlanInfo;
  }): Promise<void> {
    if (input.change === "no-change" || input.plan.overrideAddingLimitations) return;

    const resource = input.change === "lite-to-full" ? "members" : "membersLite";
    const max = this.allowance(input.plan, resource);
    const current = await this.seatsTaken(input.organizationId, resource);
    if (current >= max) {
      throw new LimitExceededError(resource, current, max);
    }
  }

  private activePlan(
    organizationId: string,
    user: OrganizationPlanUser | undefined,
  ): Promise<PlanInfo> {
    // The plan provider's own caller shape is the Enterprise licensing one and
    // the membership half may not name it, so the structural person the two
    // writes already carry is forwarded as it stands.
    return this.options.plans.getActivePlan({
      organizationId,
      ...(user ? { user } : {}),
    } as never);
  }

  private allowance(plan: PlanInfo, resource: "members" | "membersLite"): number {
    return resource === "members" ? plan.maxMembers : plan.maxMembersLite;
  }

  private seatsTaken(organizationId: string, resource: "members" | "membersLite"): Promise<number> {
    return resource === "members"
      ? this.options.memberships.getMemberCount(organizationId)
      : this.options.memberships.getMembersLiteCount(organizationId);
  }
}

/**
 * The prompt-tag seeding a new organization gets, absent.
 */
class LoggedApiOrganizationPromptSeed extends OrganizationPromptSeedPort {
  static create(options: {
    processName: string;
    logger: Pick<Logger, "warn" | "error">;
  }): LoggedApiOrganizationPromptSeed {
    return new LoggedApiOrganizationPromptSeed(options.processName, options.logger);
  }

  private constructor(
    private readonly processName: string,
    private readonly logger: Pick<Logger, "warn" | "error">,
  ) {
    super();
  }

  async seedTagsForOrganization(input: { organizationId: string }): Promise<void> {
    this.logger.warn(
      { organizationId: input.organizationId },
      `${this.processName} composes no prompt service, so the new organization starts with no prompt tags.`,
    );
  }

  reportCompensationFailure(error: Error): void {
    this.logger.error({ error }, "Organization provisioning could not undo its own commit");
  }
}
