/**
 * `organization.*` — the members of a tenant, their team bindings, its audit
 * trail and its invitations — composed as its own feature.
 *
 * Three groups of answers, and the split is the point. The row reads and the
 * permission probes run on this process's own connection and its one AuthZ
 * service; the rules that MOVED — the seat constraints, the role-naming
 * convention, the invitation display status, the team enrichment — are
 * imported from `@langwatch/organization-server` rather than restated; and the
 * invitation COMMANDS come from a port, because the service behind them is
 * composed once for both doors that administer invitations.
 *
 * ## The named absences
 *
 * {@link ApiOrganizationInvitePort} is the injection seam for the invitation
 * half. An injected port wins; a process that injects none composes one over
 * its own graph, and only a process with no grant ledger or no role service
 * still refuses BY NAME — an empty invite list would tell an administrator
 * nobody had been invited.
 *
 * {@link ApiEnterpriseApplicationPort} carries the usage-limit notifier. Absent,
 * the resource-limit notification is logged rather than sent: it announces a
 * limit somebody already hit, so refusing the write that hit it would be a
 * second failure on top of the first.
 */
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
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  LITE_MEMBER_VIEWER_ONLY_ERROR,
  MemberSeatLimitReachedError,
  OrganizationNotFoundError,
  assertNoPersonalTeamScope,
  buildInviteAcceptUrl,
  enrichTeamWithRoleBindings,
  isCustomRole,
  isTeamRoleAllowedForOrganizationRole,
  resolveInviteDisplayStatus,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  type OrganizationTrpcPorts,
  type TeamRoleValue,
} from "@langwatch/organization-server";
import { RoleBindingScopeType } from "@langwatch/prisma-client/generated";
import type { RoleService } from "@langwatch/role-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { composeApiOrganizationInvites } from "../../app/api-organization-invites.composition";
import { signUpDataSchema } from "../../app/api-trpc-collaborators.identity.composition";
import type { ApiEnterpriseApplicationPort } from "../enterprise/enterprise.composition";
import { createOrganizationTrpcRouter } from "./organization-trpc.mount";

/**
 * The platform application's licence-limit copy, stated here.
 *
 * The message a member reads when an organization is out of full seats. Stated
 * rather than imported because the licence-enforcement vertical has not moved,
 * and the words are what a customer sees.
 */
const FULL_MEMBER_LIMIT_MESSAGE = "Cannot complete action: full member limit reached";

/**
 * The invitation half of `organization.*`, for a deployment that composed one.
 *
 * One port for twelve procedures because they are one service: an invitation
 * is created, listed, resent, revoked, matched to an acceptor and applied by
 * the same ledger, and a process holding half of it would offer an
 * administrator a list it cannot act on.
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
    | "findLandingProjectSlug"
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
}>;

/** The one namespace this feature mounts. */
export type ComposedOrganizationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOrganizationTrpcRouter>;
}>;

/** Composes `organization.*` over this process's own graph. */
export function composeOrganizationFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: OrganizationPeers;
  /**
   * The process's ONE fixed-window counter.
   *
   * The same instance every other throttle on this process meters through: two
   * limiters would give one caller two budgets, which is the whole reason the
   * production composition holds a single one.
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

  return {
    router: (mount) => createOrganizationTrpcRouter({ ...mount, auditLogCheck, ports }),
  };
}

/**
 * `organization.*` on a process that composed no graph to administer.
 *
 * The namespace still mounts and every call refuses by name, so an
 * administrator is told the deployment cannot answer rather than shown an
 * organization with no members in it.
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
     *
     * Bounded concurrency rather than a fan-out: a large organization's
     * project list would otherwise open one connection per project against the
     * same pool the request itself is running on.
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

    enrichTeamWithRoleBindings,

    demoProject: () => options.demoProject,
    decryptStoredSecret: (value) => decryptStoredSecret(peers.encryption, value),

    /**
     * Both Enterprise plan gates, over the ONE plan provider this process
     * resolves every allowance through. `assertEnterprisePlanType` is the same
     * fail-closed equality test the platform ran: anything that is not
     * `ENTERPRISE` is refused, including a tier this build does not know.
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
     *
     * The same refusal the identity half already answers with for
     * `OrganizationSeatLicensePort`: a process with no seat licence cannot
     * decide whether a change stays within the licensed count, and permitting
     * it would let an organization over its own limit.
     */
    assertTeamRoleChangeWithinSeatLimits: () =>
      Promise.reject(
        new ApiOrganizationUnavailableError(
          "Enterprise seat licence, so it cannot authorize a member role change",
        ),
      ),
    assertNoPersonalTeamScope: async (_ctx, { teamId }) => {
      await assertNoPersonalTeamScope({
        client: prisma,
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
    findLandingProjectSlug: (ctx, input) =>
      inviteports
        ? inviteports.findLandingProjectSlug(ctx, input)
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
     * The product trail, on a process with no analytics sink. Every one of
     * these is fire-and-forget by construction — a marketing signal on
     * somebody's invitation — so an absent sink logs once rather than refusing
     * the invitation it was meant to announce.
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
 * The audit-log read's own check: the ORGANIZATION tier, always.
 *
 * A bare `permission("auditLog:view")` cannot express this. `auditLog` is
 * grantable at project, team and organization, and the declared check resolves
 * to the narrowest tier whose id the input carries — so the optional
 * `projectId` filter would move the whole check to the project tier and leave
 * `organizationId`, the id the query is ANCHORED on, unauthorized. A caller
 * holding `auditLog:view` on any one project could then read a different
 * organization's org-scoped trail.
 *
 * So the organization is checked unconditionally, and when a project filter is
 * present the project is checked as well, so a project-scoped grant cannot
 * widen the read past that project either.
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
 * Runs one asynchronous read over a list, a few at a time.
 *
 * Bounded rather than a fan-out: an organization's project list can be long,
 * and one decision per project opened at once would starve the same connection
 * pool the request itself is running on.
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
 * An invited address, masked, for a deployment with no invitation service.
 *
 * The same shape the invitation service produces: enough of the address for
 * the person holding the link to recognise whether it is theirs, and not
 * enough to learn somebody else's.
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
    });
    this.name = "ApiOrganizationUnavailableError";
  }
}
