/**
 * `organization.*` — the members of a tenant, their team bindings, its audit trail and
 * its invitations — composed as its own feature. Three groups of answers, and the split
 * is the point.
 */
import type { AuthService } from "@langwatch/auth-contract";
import {
  declareAuthzMiddleware,
  type AuthzBindingForSynthesis,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
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
  UsageMembershipPort,
  type RoleChangeType,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import {
  EmailJoinRequestNotifier,
  IdentityEventingPort,
  JoinRequestGuards,
  JoinRequestLedgerWriterAdapter,
  JoinRequestService,
  JoinRequestsService,
  PostgresIdentityEmailAdapter,
  PrismaJoinCandidateRepository,
  PrismaJoinMembership,
  PrismaJoinRequestProjectionRepository,
  PrismaJoinRequestReadRepository,
  PrismaJoinSettings,
} from "@langwatch/identity-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  LITE_MEMBER_VIEWER_ONLY_ERROR,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  assertNoPersonalTeamScope,
  PostgresPersonalTeamScopeAdapter,
  buildInviteAcceptUrl,
  isCustomRole,
  isTeamRoleAllowedForOrganizationRole,
  OrganizationMembershipService,
  resolveInviteDisplayStatus,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  OrganizationApp,
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
  PostgresOrganizationMembershipAdapter,
  type GroupTrpcPorts,
  type JoinRequestTrpcPorts,
  type OnboardingTrpcPorts,
  type OrganizationPlanUser,
  type OrganizationProvisioningPort,
  type OrganizationRestService,
  type OrganizationSeatDecision,
  type OrganizationTrpcPorts,
  type TeamRoleValue,
} from "@langwatch/organization-server";
import {
  RoleBindingScopeType,
  type OrganizationUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { UserApp } from "@langwatch/user-server";
import { z } from "zod";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import { composeApiOrganizationInvites } from "../../app/api-organization-invites.composition";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port";
import type { ApiEnterpriseApplicationPort } from "../enterprise/enterprise.composition";
import {
  createGroupTrpcRouter,
  createJoinRequestTrpcRouter,
  createOnboardingTrpcRouter,
  createOrganizationTrpcRouter,
} from "./organization-trpc.mount";

/**
 * The questionnaire the sign-up form collects, as the ceremony forwards it. Opaque to the
 * organization package on purpose — the shape is the deployment's — so the schema is
 * declared where the process that reads the answers lives.
 */
export const signUpDataSchema = z.object({}).passthrough();

/**
 * The platform application's licence-limit copy, stated here. The message a member reads
 * when an organization is out of full seats. Stated rather than imported because the
 * licence-enforcement vertical has not moved, and the words are what a customer sees.
 */
const FULL_MEMBER_LIMIT_MESSAGE = "Cannot complete action: full member limit reached";

/**
 * The invitation half of `organization.*`, for a deployment that composed one.
 */
export abstract class ApiOrganizationInvitePort {
  /** Everything `organization.*` asks the invitation service. */
  abstract readonly ports: Pick<
    OrganizationTrpcPorts<never>,
    | "createInvites"
    | "revokeInvite"
    | "assertInviteSendAllowed"
    | "resendInvite"
    | "listInvites"
    | "matchInviteToAcceptor"
    | "maskInvitedAddress"
    | "applyInvite"
    | "tryFindLandingProjectSlug"
    | "resolveJoinRequestByInvitation"
    | "withdrawJoinRequestOnInvitationAccepted"
  >;
}

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
  roles?: RoleService | undefined;
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
  /** The same project service the tenancy graph composed. */
  projects: ProjectService;
  /** The grant ledger every membership write states its access on. */
  grants: AuthzGrantsService;
  /** The Auth service a disabled membership's browser sessions are revoked through. */
  auth: AuthService;
  /**
   * The signed-in person's application, for the personal workspace the sign-up
   * ceremony provisions. The SAME one `user.*` answers from: a second would
   * provision a workspace for somebody the /me screens do not know.
   */
  users: Pick<UserApp, "ensurePersonalWorkspace">;
  /** The event stack the join-request ledger appends and stages through. */
  eventing: IdentityEventingPort;
  /** The messages this half sends, where the deployment composed a gateway. */
  mail?: ApiPersonMailPort | undefined;
  /** Names this process in every refusal the membership half raises. */
  processName: string;
}>;

/** The four namespaces this feature mounts, and the slice behind them. */
export type ComposedOrganizationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOrganizationTrpcRouter>;
  /** `group.*`, `joinRequests.*` and `onboarding.*`, over the membership half. */
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    group: ReturnType<typeof createGroupTrpcRouter>;
    joinRequests: ReturnType<typeof createJoinRequestTrpcRouter>;
    onboarding: ReturnType<typeof createOnboardingTrpcRouter>;
  }>;
  /** The `ctx.app.organizations` slice. */
  app: OrganizationApp;
  /**
   * The organization object the MANAGEMENT REST family serves from: the canonical
   * contract's settings reads and writes, plus the membership operations the contract
   * does not declare, routed onto one object.
   */
  rest: OrganizationRestService | undefined;
  /**
   * The same object again, in the shape `/api/organizations` takes.
   */
  provisioning: (OrganizationService & OrganizationProvisioningPort) | undefined;
}>;

/** Composes `organization.*` over this process's own graph. */
export function composeOrganizationFeature(options: {
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
}): ComposedOrganizationFeature {
  const logger = createLogger("langwatch:api:organization");
  const ports = organizationPorts(options, logger);
  const auditLogCheck = auditLogCheckFor(options.infrastructure.authz);
  const membership = options.peers.membership
    ? composeMembershipHalf({
        prisma: options.infrastructure.prisma,
        plans: options.infrastructure.plans,
        peers: options.peers.membership,
        rateLimit: (input) => options.rateLimit(input),
        logger,
      })
    : undefined;

  return {
    router: (mount) => createOrganizationTrpcRouter({ ...mount, auditLogCheck, ports }),
    routers: (mount) => membershipRouters(mount, membership?.ports ?? refusingMembershipPorts()),
    app: membership?.app ?? refusingOrganizationApp(),
    rest: membership?.rest,
    provisioning: membership?.provisioning,
  };
}

/**
 * `organization.*` on a process that composed no graph to administer. The namespace still
 * mounts and every call refuses by name, so an administrator is told the deployment
 * cannot answer rather than shown an organization with no members in it.
 */
export function refusingOrganizationFeature(): ComposedOrganizationFeature {
  const refuse = (): never => {
    throw new ApiOrganizationUnavailableError("organization directory");
  };
  // The two members the namespace reads while it is being BUILT rather than
  // called: the questionnaire schema its input parser is derived from, and the
  // role-naming test its member list renders with.
  const buildTime: Record<string, unknown> = { signUpDataSchema, isCustomRole };

  return {
    router: (mount) =>
      createOrganizationTrpcRouter({
        ...mount,
        auditLogCheck: declareAuthzMiddleware(AUDIT_LOG_DECLARATION, () => refuse()),
        ports: new Proxy(
          {},
          {
            get: (_target, property) => buildTime[property as string] ?? refuse,
            has: () => true,
          },
        ) as OrganizationTrpcPorts<typeof signUpDataSchema>,
      }),
    routers: (mount) => membershipRouters(mount, refusingMembershipPorts()),
    app: refusingOrganizationApp(),
    rest: undefined,
    provisioning: undefined,
  };
}

/**
 * The forty-six answers `organization.*` needs from this deployment.
 */
function organizationPorts(
  options: Readonly<{
    infrastructure: ApiTrpcInfrastructure;
    peers: OrganizationPeers;
    rateLimit(
      input: Readonly<{ key: string; windowSeconds: number; max: number }>,
    ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
    baseHost: string;
    demoProject: Readonly<{ userId: string; projectId: string }>;
  }>,
  logger: Logger,
): OrganizationTrpcPorts<typeof signUpDataSchema> {
  const { prisma, authz } = options.infrastructure;
  const plans: Pick<PlanProvider, "getActivePlan"> = options.infrastructure.plans;
  const { peers } = options;
  // Injected wins, so a host that composed its own invitation service keeps
  // it. Otherwise this process composes one over its own graph, and only a
  // process missing the grant ledger or the role service still refuses.
  const invites =
    peers.invites ??
    (peers.authzGrants && peers.roles
      ? composeApiOrganizationInvites({
          prisma,
          grants: peers.authzGrants,
          roles: peers.roles,
          plans,
          rateLimit: (input) => options.rateLimit(input),
          baseHost: options.baseHost,
        }).trpc
      : undefined);
  const refuseInvitations = (what: string): Promise<never> =>
    Promise.reject(new ApiOrganizationUnavailableError(`invitation service, so it cannot ${what}`));
  const inviteports = invites?.ports;

  return {
    signUpDataSchema,

    probeOrganizationPermission: (ctx, organizationId, permission) =>
      authz.hasPermission({ userId: actorId(ctx), permission, organizationId }),

    /**
     * Which of an organization's projects this caller holds one permission on.
     */
    batchProjectPermissions: async (ctx, input) => {
      const userId = actorId(ctx);
      const decisions = await mapWithConcurrency([...input.projectIds], (projectId) =>
        authz
          .hasPermission({ userId, permission: input.permission, projectId })
          .then((permitted) => [projectId, permitted] as const),
      );
      return new Map(decisions);
    },

    listBindingsForSynthesis: (_ctx, input) =>
      authz.listBindingsForSynthesis(input) as Promise<AuthzBindingForSynthesis[]>,

    enrichTeamWithRoleBindings: OrganizationMembershipService.enrichTeamWithRoleBindings,

    demoProject: () => options.demoProject,
    decryptStoredSecret: (value) => decryptStoredSecret(peers.encryption, value),

    /**
     * Both Enterprise plan gates, over the ONE plan provider this process resolves every
     * allowance through.
     */
    assertCustomRolesAllowed: async (_ctx, { organizationId }) => {
      const plan = await plans.getActivePlan({ organizationId });
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    },
    assertAuditLogsAllowed: async (_ctx, { organizationId }) => {
      const plan = await plans.getActivePlan({ organizationId });
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
      });
    },
    isCustomRole,

    fullMemberLimitMessage: FULL_MEMBER_LIMIT_MESSAGE,
    liteMemberViewerOnlyMessage: LITE_MEMBER_VIEWER_ONLY_ERROR,
    asMemberSeatLimitReached: (error) =>
      error instanceof MemberSeatLimitReachedError
        ? {
            limitType: error.meta.limitType,
            current: error.meta.current,
            max: error.meta.max,
          }
        : null,
    /**
     * Always null, and correctly so rather than degraded: this process
     * composes no licence-enforcement service, so nothing here raises a
     * resource-limit refusal for the transport to recognise.
     */
    asResourceLimitExceeded: () => null,
    isOrganizationNotFound: (error) => error instanceof OrganizationNotFoundError,
    notifyResourceLimitReached: async (_ctx, input) => {
      const enterprise = peers.enterprise;
      if (!enterprise) {
        logger.debug(
          { organizationId: input.organizationId, limitType: input.limitType },
          "no Enterprise application is composed: the resource-limit notification for this organization is not sent",
        );
        return;
      }
      await enterprise.application.usageLimits.notifyResourceLimitReached(input as never);
    },
    isTeamRoleAllowedForOrganizationRole: ({ organizationRole, teamRole }) =>
      isTeamRoleAllowedForOrganizationRole({
        organizationRole,
        teamRole: teamRole as TeamRoleValue,
      }),
    /**
     * The seat guard on an external role change, refused by name.
     */
    assertTeamRoleChangeWithinSeatLimits: () =>
      Promise.reject(
        new ApiOrganizationUnavailableError(
          "Enterprise seat licence, so it cannot authorize a member role change",
        ),
      ),
    assertNoPersonalTeamScope: async (_ctx, { teamId }) => {
      await assertNoPersonalTeamScope({
        reader: PostgresPersonalTeamScopeAdapter.create({ database: prisma }),
        scopes: [{ scopeType: RoleBindingScopeType.TEAM, scopeId: teamId }],
      });
    },
    tryGetTeamOrganizationId: async (_ctx, { teamId }) => {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { organizationId: true },
      });
      return team?.organizationId ?? null;
    },
    tryGetOrganizationMemberRole: async (_ctx, { organizationId, userId }) => {
      const membership = await prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      });
      return membership?.role ?? null;
    },

    createInvites: (ctx, input) =>
      inviteports
        ? inviteports.createInvites(ctx, input)
        : refuseInvitations("invite anybody to this organization"),
    revokeInvite: (ctx, input) =>
      inviteports
        ? inviteports.revokeInvite(ctx, input)
        : refuseInvitations("revoke an invitation"),
    assertInviteSendAllowed: (ctx, input) =>
      inviteports
        ? inviteports.assertInviteSendAllowed(ctx, input)
        : refuseInvitations("meter invitation sends"),
    resendInvite: (ctx, input) =>
      inviteports
        ? inviteports.resendInvite(ctx, input)
        : refuseInvitations("resend an invitation"),
    buildInviteAcceptUrl: (inviteCode) => buildInviteAcceptUrl(options.baseHost, inviteCode),
    listInvites: (ctx, input) =>
      inviteports
        ? inviteports.listInvites(ctx, input)
        : refuseInvitations("list this organization's invitations"),
    /**
     * A row read, so it is answered here rather than behind the port: the code
     * in the link addresses one invitation, and reading it is what tells a
     * signed-in person which organization they were asked to join.
     */
    tryGetInviteByCode: (_ctx, { inviteCode }) =>
      prisma.organizationInvite.findUnique({
        where: { inviteCode },
        include: { organization: true },
      }),
    resolveInviteDisplayStatus,
    matchInviteToAcceptor: (ctx, input) =>
      inviteports
        ? inviteports.matchInviteToAcceptor(ctx, input)
        : refuseInvitations("match an invitation to the person accepting it"),
    maskInvitedAddress: (email) =>
      inviteports ? inviteports.maskInvitedAddress(email) : maskAddress(email),
    applyInvite: (ctx, input) =>
      inviteports ? inviteports.applyInvite(ctx, input) : refuseInvitations("accept an invitation"),
    tryFindLandingProjectSlug: (ctx, input) =>
      inviteports
        ? inviteports.tryFindLandingProjectSlug(ctx, input)
        : refuseInvitations("resolve where an accepted invitation lands"),
    inviteNotFoundError: () => new InviteNotFoundError("Invitation not found"),
    inviteExpiredError: () => new InviteExpiredError(),
    inviteWrongAccountError: (maskedEmail) => new InviteWrongAccountError(maskedEmail),
    inviteAlreadyAcceptedMessage: INVITE_ALREADY_ACCEPTED_MESSAGE,
    inviteNotReadyMessage: INVITE_NOT_READY_MESSAGE,

    resolveJoinRequestByInvitation: (ctx, input) =>
      inviteports
        ? inviteports.resolveJoinRequestByInvitation(ctx, input)
        : refuseInvitations("settle a join request against an invitation"),
    withdrawJoinRequestOnInvitationAccepted: (ctx, input) =>
      inviteports
        ? inviteports.withdrawJoinRequestOnInvitationAccepted(ctx, input)
        : refuseInvitations("withdraw a join request an invitation superseded"),
    tryFindUserIdByEmail: async (_ctx, { email }) => {
      const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
      return user?.id ?? null;
    },

    /**
     * The product trail, on a process with no analytics sink.
     */
    trackServerEvent: (input) => {
      logger.debug(
        { event: input.event },
        "no product-analytics sink is composed: this organization event is not recorded",
      );
    },
    fireTeamMemberInvitedNurturing: () => undefined,
    fireInviteAcceptedNurturing: () => undefined,
    sendSlackSignupEvent: () => Promise.resolve(),
    reportError: (error) => {
      logger.error({ error }, "an organization surface failed");
    },
  } as OrganizationTrpcPorts<typeof signUpDataSchema>;
}

/** What the audit-log read declares, in both the real check and the refusal. */
const AUDIT_LOG_DECLARATION = {
  kind: "custom",
  reason:
    "the audit-log read is authorized at the organization tier the query is anchored on, never the optional project filter",
  permissions: ["auditLog:view"],
} as const;

/**
 * The audit-log read's own check: the ORGANIZATION tier, always. A bare
 * `permission("auditLog:view")` cannot express this.
 */
function auditLogCheckFor(authz: AuthzService): unknown {
  return declareAuthzMiddleware(AUDIT_LOG_DECLARATION, async (params: never) => {
    const call = params as unknown as ScopeCheckParams<{
      organizationId: string;
      projectId?: string;
    }>;
    const userId = call.ctx.actor().id;
    const permitted = await authz.hasPermission({
      userId,
      permission: "auditLog:view",
      organizationId: call.input.organizationId,
    });
    if (!permitted) throw new AuditLogDeniedError();
    if (call.input.projectId) {
      const forProject = await authz.hasPermission({
        userId,
        permission: "auditLog:view",
        projectId: call.input.projectId,
      });
      if (!forProject) throw new AuditLogDeniedError();
    }
    call.ctx.permissionChecked = true;
    return call.next();
  });
}

/** The caller may not read this organization's audit trail. */
class AuditLogDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to read this audit trail", {
      httpStatus: 403,
      fault: "customer",
      meta: { permission: "auditLog:view" },
    });
    this.name = "AuditLogDeniedError";
  }
}

/** What a `kind: "custom"` check is handed on this process's root. */
type ScopeCheckParams<TInput> = {
  ctx: { actor(): { id: string }; permissionChecked?: boolean };
  input: TInput;
  next(): unknown;
};

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/**
 * Runs one asynchronous read over a list, a few at a time. Bounded rather than a fan-out:
 * an organization's project list can be long, and one decision per project opened at once
 * would starve the same connection pool the request itself is running on.
 */
const PERMISSION_PROBE_CONCURRENCY = 8;

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array<TResult>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(PERMISSION_PROBE_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index] as TItem);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function decryptStoredSecret(encryption: SecretEncryptionPort | undefined, value: string): string {
  if (!encryption) {
    throw new ApiOrganizationUnavailableError(
      "stored-secret key, so it cannot read this organization's stored settings",
    );
  }
  return encryption.decrypt(value);
}

/**
 * An invited address, masked, for a deployment with no invitation service. The same shape
 * the invitation service produces: enough of the address for the person holding the link
 * to recognise whether it is theirs, and not enough to learn somebody else's.
 */
function maskAddress(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
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
  app: OrganizationApp;
  rest: OrganizationRestService;
  provisioning: OrganizationService & OrganizationProvisioningPort;
  ports: MembershipPorts;
}>;

/** The three port groups the membership namespaces are built on. */
type MembershipPorts = Readonly<{
  group: GroupTrpcPorts;
  joinRequests: JoinRequestTrpcPorts;
  onboarding: OnboardingTrpcPorts<typeof signUpDataSchema>;
}>;

function membershipRouters(mount: ApiTrpcFeatureMount, ports: MembershipPorts) {
  return {
    group: createGroupTrpcRouter({ ...mount, ports: ports.group }),
    joinRequests: createJoinRequestTrpcRouter({ ...mount, ports: ports.joinRequests }),
    // The sign-up ceremony, beside the `organization.createAndAssign` it is
    // built on: same package, same questionnaire schema, same opt-out reason.
    onboarding: createOnboardingTrpcRouter({ ...mount, ports: ports.onboarding }),
  };
}

/**
 * Composes the membership half over this process's own graph. The organization service,
 * the project service, the grant ledger and the user directory all arrive already
 * composed.
 */
function composeMembershipHalf(options: {
  prisma: PrismaClient;
  plans: Pick<PlanProvider, "getActivePlan">;
  peers: OrganizationMembershipPeers;
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  logger: Logger;
}): OrganizationMembership {
  const { prisma, plans, peers, logger } = options;
  const { organizations, projects, grants, auth, users, eventing, mail, processName } = peers;
  const unavailable = (capability: string) => new ApiOrganizationUnavailableError(capability);

  const membership = PostgresOrganizationMembershipAdapter.create({
    database: prisma,
    grants,
    prompts: LoggedApiOrganizationPromptSeed.create({ processName, logger }),
    // The seat gate, over the SAME counts the usage panel shows and the SAME
    // plan the invitation half spends a seat against: an administrator refused
    // here and an administrator shown their usage there cannot be told two
    // different numbers about one organization.
    seats: ApiOrganizationSeatLicense.create({
      plans,
      memberships: PrismaUsageMembershipRepository.create(prisma),
    }),
    sessions: AuthServiceOrganizationSessionRevocation.create(auth),
    grantCache: AuthzOrganizationGrantCache.create(grants),
  }).build();

  const organizationsForApp = new Proxy(organizations, {
    get(target, property, receiver) {
      if (typeof property === "string" && MEMBERSHIP_OPERATIONS.has(property)) {
        const operation = (membership as unknown as Record<string, unknown>)[property];
        return typeof operation === "function" ? operation.bind(membership) : operation;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Parameters<typeof OrganizationApp.create>[0]["organizations"];

  const identityEmails = PostgresIdentityEmailAdapter.create({ database: prisma }).build();

  function notifyNothing(what: string): void {
    logger.warn(
      { processName },
      `${processName} composes no mail gateway, so nobody was told that ${what}.`,
    );
  }

  const joinRequests = JoinRequestsService.create({
    requests: new JoinRequestService(
      new JoinRequestGuards({ requests: new PrismaJoinRequestReadRepository(prisma) }),
      JoinRequestLedgerWriterAdapter.create({
        projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
        eventing,
      }),
    ),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: new PrismaJoinMembership(prisma, grants),
    notifier: mail
      ? new EmailJoinRequestNotifier(prisma, mail)
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
    settings: new PrismaJoinSettings(prisma),
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

  return {
    app: OrganizationApp.create({ organizations: organizationsForApp, projects }),
    // The SAME merged object `OrganizationApp` reads, published so the
    // management REST family serves from it too. A second service over the
    // same rows would let `/api/organization/members` and the members screen
    // disagree about who is in an organization.
    rest: organizationsForApp as unknown as OrganizationRestService,
    provisioning: organizationsForApp as unknown as OrganizationService &
      OrganizationProvisioningPort,
    ports: {
      group: {
        /**
         * Groups arrive with SCIM, which is an Enterprise capability read per
         * organization out of a billing store this process does not hold.
         */
        assertScimAllowed: () =>
          Promise.reject(
            unavailable(
              "Enterprise plan store, so it cannot confirm this organization carries SCIM",
            ),
          ),
      },

      joinRequests: {
        lookup: (_ctx, input) => joinRequests.lookup(input),
        pendingForUser: (_ctx, input) => joinRequests.pendingForUser(input),
        request: (_ctx, input) => joinRequests.request(input),
        withdraw: (_ctx, input) => joinRequests.withdraw(input),
        pendingForOrganization: (_ctx, input) => joinRequests.pendingForOrganization(input),
        approve: (_ctx, input) => joinRequests.approve(input),
        reject: (_ctx, input) => joinRequests.reject(input),
        readJoining: (_ctx, input) => joinRequests.readJoining(input),
        setJoining: (_ctx, input) => joinRequests.setJoining(input),
        tryResolveVerifiedEmail: (_ctx, input) => verifiedEmailFor(input),
        listUserNames: (_ctx, { userIds }: Readonly<{ userIds: readonly string[] }>) =>
          prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true },
          }),
      },

      onboarding: {
        signUpDataSchema,
        /**
         * The standard AI-tool catalogue is an Enterprise governance capability.
         * Non-fatal at the call site — the portal's own read provisions the same
         * set — so this refuses by name and the ceremony carries on.
         */
        ensureDefaultAiToolCatalog: () =>
          Promise.reject(
            unavailable(
              "Enterprise governance service, so it seeded no standard AI tool catalogue",
            ),
          ),
        ensurePersonalWorkspace: (_ctx, input) => users.ensurePersonalWorkspace(input),
        /**
         * The first project. It goes through the project service this process
         * composed rather than a second creation path, so it writes the same
         * rows the project surface writes.
         */
        createProject: async (_ctx, input) => {
          const project = await projects.create({
            organizationId: input.organizationId,
            teamId: input.teamId,
            name: input.name,
            language: input.language,
            framework: input.framework,
          });
          return { success: true, projectSlug: project.slug };
        },
        // The deployment's marketing traffic. Fire-and-forget by construction:
        // a sign-up that could not be announced still created the organization.
        sendSlackSignupEvent: async () => notifyNothing("somebody signed up"),
        sendHubspotSignupForm: async () => notifyNothing("somebody signed up"),
        fireSignupNurturing: () => notifyNothing("somebody signed up"),
        recordIntegrationMethod: () => notifyNothing("somebody chose an integration method"),
        reportError: (error: unknown, context: unknown) => {
          logger.error({ error, context }, "Onboarding step failed");
        },
      },
    } as MembershipPorts,
  };
}

/**
 * One organization object, two owners. `OrganizationApp` reads a single `organizations`
 * dependency that is the canonical contract AND the fourteen membership operations the
 * contract does not declare.
 */
const MEMBERSHIP_OPERATIONS = new Set<string>([
  "createAndAssign",
  "deleteMember",
  "setMemberDisabled",
  "getAllForUser",
  "tryGetOrganizationWithMembers",
  "tryGetMemberById",
  "getAllMembers",
  "tryGetUserOrgRoleByTeamId",
  "tryGetPrimaryIntent",
  "updateTeamMemberRole",
  "changeMemberRole",
  "getAuditLogs",
  // The paged listing and the single-member read the MANAGEMENT REST family
  // asks for. On this list for the same reason as the twelve above: the
  // canonical contract declares neither, so routing them here is what makes
  // one object answer both halves rather than two objects answering one
  // question each.
  "listMembers",
  "getMember",
  // The four INSTANCE-PROVISIONING operations `/api/organizations` performs. Same reason
  // again: the canonical contract does not declare them because they run before any
  // credential for the organization exists, so the door that creates a tenant and the
  // screens that administer it afterwards must resolve through one object or a
  // provisioned organization would be invisible to the second.
  "createForProvisioning",
  "listProvisioningSummaries",
  "tryGetProvisioningSummary",
  "deleteProvisionedOrganization",
]);

/** The membership namespaces on a process that composed no membership graph. */
function refusingMembershipPorts(): MembershipPorts {
  const refuse = (): never => {
    throw new ApiOrganizationUnavailableError("membership graph");
  };
  const refusing = <T>(buildTime: Record<string, unknown> = {}): T =>
    new Proxy(buildTime, {
      get: (target, property) => target[property as string] ?? refuse,
      has: () => true,
    }) as T;

  return {
    group: refusing<GroupTrpcPorts>(),
    joinRequests: refusing<JoinRequestTrpcPorts>(),
    // The one member the namespace reads while it is being BUILT rather than
    // called: the questionnaire schema its input parser is derived from.
    onboarding: refusing<OnboardingTrpcPorts<typeof signUpDataSchema>>({ signUpDataSchema }),
  };
}

/** The `ctx.app.organizations` slice on a process with no membership graph. */
function refusingOrganizationApp(): OrganizationApp {
  return new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiOrganizationUnavailableError("organization directory");
      },
      has: () => true,
    },
  ) as OrganizationApp;
}

/**
 * The seat licence, over the SAME plan provider and the SAME membership counts every
 * other allowance in this process reads.
 */
class ApiOrganizationSeatLicense extends OrganizationSeatLicensePort {
  static create(options: {
    plans: Pick<PlanProvider, "getActivePlan">;
    memberships: UsageMembershipPort;
  }): ApiOrganizationSeatLicense {
    return new ApiOrganizationSeatLicense(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<PlanProvider, "getActivePlan">;
      memberships: UsageMembershipPort;
    },
  ) {
    super();
  }

  async checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision> {
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

/** Session revocation, over the Auth service this process already composed. */
class AuthServiceOrganizationSessionRevocation extends OrganizationSessionRevocationPort {
  static create(auth: AuthService): AuthServiceOrganizationSessionRevocation {
    return new AuthServiceOrganizationSessionRevocation(auth);
  }

  private constructor(private readonly auth: AuthService) {
    super();
  }

  async revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    await this.auth.revokeAllBrowserSessions(input);
  }
}

/** The authorization snapshot cache, over the grant ledger this process serves. */
class AuthzOrganizationGrantCache extends OrganizationGrantCachePort {
  static create(grants: AuthzGrantsService): AuthzOrganizationGrantCache {
    return new AuthzOrganizationGrantCache(grants);
  }

  private constructor(private readonly grants: AuthzGrantsService) {
    super();
  }

  async invalidateOrganization(input: { organizationId: string }): Promise<void> {
    await this.grants.invalidateOrganization(input);
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
