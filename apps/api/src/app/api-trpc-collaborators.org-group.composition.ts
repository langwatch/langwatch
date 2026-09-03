/**
 * The ORG GROUP half of {@link ApiTrpcCollaborators}: the nine surfaces a
 * TENANT is administered through.
 *
 *   organization.*        members, team bindings, the audit trail, invitations
 *   project.*             a project's lifecycle and its settings form
 *   codingAgents.*        what the coding agents did inside those projects
 *   automation.*          the triggers a project fires on, and their channels
 *   emailSuppression.*    who asked those channels to stop writing to them
 *   license.* / licenseEnforcement.* / scimToken.* / ssoConnections.*
 *                         the Enterprise four, through the one seam a core
 *                         process may see them through
 *
 * They are one composition because they are one graph at a composition root:
 * every one of them is a WRITE against the tenant rather than against what the
 * tenant recorded, and all of them run on this process's own Prisma
 * connection, its own AuthZ service and the tenancy graph it already composed.
 *
 * ## This half OVERLAYS
 *
 * It folds onto a base and passes an absent base through untouched, the way
 * the analytics, execution and product-group halves do. It can genuinely be
 * missing: a process that composed no tenancy graph has no organization or
 * project directory, and every surface here resolves one.
 *
 * ## The named absences
 *
 * `ApiOrganizationInvitePort` — the injection seam for the invitation half of
 * `organization.*`, and no longer an absence. The invitation service moved
 * into `@langwatch/organization-server` and its four reaches all resolve here:
 * the licence-enforcement counts through `@langwatch/entitlement-server`'s
 * membership repository, the plan provider this half already holds, the role
 * service `role.*` mounts, and the mailer as a port
 * (`api-organization-invites.composition.ts`). An injected port still wins; a
 * process that injects none composes one, and only a process with no grant
 * ledger or no role service still refuses BY NAME — an empty invite list would
 * tell an administrator nobody had been invited.
 *
 * `ApiViewerProtectionsPort` — the caller's read-time redactions for one
 * project. It is the SAME resolution `ApiTraceReadStackPort.getViewerProtections`
 * answers, and it is absent for the same reason: the protections resolver is
 * ~230 lines of platform code over the data-privacy policy, the visibility
 * window and the RBAC group facts. Absent, `codingAgents.sessionsList` and
 * `project.getFieldRedactionStatus` refuse by name rather than guessing —
 * guessing high would show a reader captured content they may not see, and
 * guessing low would tell them their project has nothing in it.
 *
 * `ApiEnterpriseApplicationPort` — the licensing application, the usage-limit
 * notifier and the SCIM application the four Enterprise namespaces read off
 * `ctx.app`, plus the back office's single sign-on ledger. Absent on a
 * deployment that composed no Enterprise application, and every procedure that
 * reaches one refuses by name. The namespaces still MOUNT: a client asking
 * "what is my licence" must be told this deployment cannot answer, not have
 * the call disappear.
 *
 * `github` — the GitHub App the coding-agent reads resolve a pull request
 * through. Composed from configuration when a deployment registered one; the
 * feature's own `configured` flag turns a blank registration into "not
 * connected" on the screen, which is true rather than degraded.
 *
 * `project.triggerTopicClustering` refuses by name: clustering runs are
 * scheduled by the worker, and a request this process accepted would be a run
 * nobody starts. `project.provisionLangyVirtualKey` logs instead of refusing —
 * it is best-effort by the port's own contract, and a failure there must never
 * cost somebody the project they just created.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  AutomationProviderRegistryAdapter,
  type AutomationApp,
} from "@langwatch/automation-server";
import {
  declareAuthzMiddleware,
  type AuthzBindingForSynthesis,
  type AuthzGrantsService,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import {
  CodingAgentApp,
  CodingAgentCallerScopeService,
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentRuntime,
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentScopePermissionsPort,
  CodingAgentBillingPolicyPort,
  type CodingAgentScopeCaller,
  type CodingAgentScopePermission,
  type CodingAgentScopeProject,
  type CodingAgentTrpcPorts,
  type CodingAgentViewerVisibility,
} from "@langwatch/coding-agent-server";
import type { CodingAgentClickHousePort } from "@langwatch/coding-agent-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
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
import { RoleBindingScopeType, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RoleService } from "@langwatch/role-contract";
import { ProjectApp, type ProjectTrpcContext } from "@langwatch/project-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import type { EmailSuppressionTrpcPorts } from "@langwatch/automation-server";
import type { ApiAuditPort } from "../api-request.policy";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication, ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";
import type { AutomationMountPorts } from "../features/automation/automation-trpc.mount";
import type { EnterpriseTrpcMountPorts } from "../features/enterprise/enterprise-trpc.mount";
import type {
  ProjectTrpcChecks,
  ProjectTrpcMountPorts,
} from "../features/project/project-trpc.mount";
import { composeApiAutomationApp } from "./api-automation.composition";
import { composeApiOrganizationInvites } from "./api-organization-invites.composition";
import { signUpDataSchema } from "./api-trpc-collaborators.identity.composition";

/**
 * The platform application's licence-limit copy, stated here.
 *
 * The message a member reads when an organization is out of full seats. Stated
 * rather than imported because the licence-enforcement vertical has not moved,
 * and the words are what a customer sees.
 */
const FULL_MEMBER_LIMIT_MESSAGE = "Cannot complete action: full member limit reached";

/**
 * The platform application's `PLATFORM_DEFAULT_RETENTION_DAYS`. Stated for the
 * reason every other half states it: the retention vertical has not moved, and
 * defaulting to a shorter window would silently shorten what a coding-agent
 * session is readable for on every deployment that never changed a setting.
 */
const PLATFORM_DEFAULT_RETENTION_DAYS = 49;

/** A capability this deployment did not compose, refused by name. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

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

/**
 * The caller's read-time redactions for one project.
 *
 * The same resolution the trace read stack answers, narrowed to the one
 * question two surfaces here ask: what may this viewer see of this project's
 * captured content, and may they price it.
 */
export abstract class ApiViewerProtectionsPort {
  abstract getViewerProtections(
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<
    Readonly<{
      canSeeCosts?: boolean | null;
      canSeeCapturedInput?: boolean | null;
      canSeeCapturedOutput?: boolean | null;
      capturedInputVisibleTo?: string | null;
      capturedOutputVisibleTo?: string | null;
    }>
  >;
}

/**
 * The Enterprise application the nineteen Enterprise namespaces read.
 *
 * One port rather than nineteen, because a deployment either composed the
 * Enterprise application or it did not: a licence without a SCIM application
 * is not a smaller product, it is a half-wired one, and a governance console
 * without the capability behind it is a page of empty lists that reads as
 * "nothing configured".
 *
 * Two groups fill from it. The org group reads the licensing, SCIM and
 * usage-limit slices and the single sign-on ledger; the gateway group reads
 * `governance`. The port is one because the deployment decision is one.
 */
export abstract class ApiEnterpriseApplicationPort {
  /** The `ctx.app` slices the four tenant surfaces read. */
  abstract readonly application: Pick<
    ApiTrpcFeatureApplication,
    "licensing" | "scimApp" | "usageLimits"
  >;
  /**
   * The `ctx.app` slices the fifteen governance and gateway-governance
   * surfaces read.
   *
   * A separate member rather than four more entries on `application` above,
   * because the two halves are filled by two different composition folds and a
   * single object would make each of them able to overwrite the other's.
   */
  abstract readonly governance: Pick<
    ApiTrpcFeatureApplication,
    "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
  >;
  /** The back office's single sign-on connection ledger. */
  abstract backoffice(): ReturnType<EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]>;
}

/** Whether a project's traces may be persisted into a dataset without charge. */
class ApiCodingAgentBilling extends CodingAgentBillingPolicyPort {
  isSourceNonBillable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export type ApiOrgGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
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
  /** The organization directory the tenancy graph composed. */
  organizations: OrganizationService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The credential service the API doors already authenticate through. */
  apiKeys: ApiKeyService;
  /** The share ledger the trace group composed: one project, one sharing rule. */
  share: ShareService;
  /** The topic tree the trace group composed. */
  topics: TopicService;
  /** The monitors a trigger watches, named in the trigger list. */
  monitors: MonitorService;
  /** This deployment's flag store, as the product-group half composed it. */
  featureFlags: FeatureFlagService;
  /** Which plan an organization is on: the persist ceiling and both plan gates. */
  plans: Pick<PlanProvider, "getActivePlan">;
  /** The deployment's cipher, for stored-object credentials and Slack tokens. */
  encryption: SecretEncryptionPort | undefined;
  /** The audit trail a key rotation and a connection command are written to. */
  audit: ApiAuditPort | undefined;
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
  /** The signing key an unsubscribe link is minted and verified with. */
  unsubscribeSecret: string | undefined;
  /** The SAME Redis the worker spends the automation persist ceiling against. */
  redis: RedisConnection | null;
  /** This deployment's public origin, for invite and unsubscribe links. */
  baseHost: string;
  /** The demo project every caller may read, where a deployment names one. */
  demoProject: Readonly<{ userId: string; projectId: string }>;
  /** The GitHub App this deployment registered, blank where it registered none. */
  github: GithubService;
  /** This process's ClickHouse, where the coding-agent sessions are projected. */
  codingAgentClickHouse: CodingAgentClickHousePort | null;
  /** The invitation service, where the deployment composed one. */
  invites?: ApiOrganizationInvitePort | undefined;
  /** The protections resolver, where the deployment composed one. */
  viewerProtections?: ApiViewerProtectionsPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** Names this process in every refusal above. */
  processName: string;
}>;

/** The application slices and the port group this half owns, composed together. */
export type ApiOrgGroupCollaborators = Readonly<{
  /** The six `ctx.app` slices this half owns. */
  application: Pick<
    ApiTrpcFeatureApplication,
    "automation" | "codingAgentApp" | "licensing" | "projects" | "scimApp" | "usageLimits"
  >;
  /** The forty-six answers `organization.*` needs from this deployment. */
  organization: OrganizationTrpcPorts<typeof signUpDataSchema>;
  /** The audit-log read's own `kind: "custom"` check, already built. */
  organizationAuditLogCheck: unknown;
  /** The six answers `project.*` needs. */
  project: ProjectTrpcMountPorts;
  /** `project.create`'s custom tier resolution and the trace-sharing demand. */
  projectChecks: ProjectTrpcChecks;
  /** What one viewer may see of one project's captured content and spend. */
  codingAgents: CodingAgentTrpcPorts;
  /** The three answers the automation transport reaches beyond automation's own. */
  automation: AutomationMountPorts;
  /** The unsubscribe pair's client address, its throttle and its audit trail. */
  emailSuppression: EmailSuppressionTrpcPorts;
  /** The SCIM plan gate, and the back office's connection ledger with its trail. */
  enterprise: EnterpriseTrpcMountPorts;
}>;

/** Composes the org-group half from this process's own graph. */
export function composeApiOrgGroupCollaborators(
  options: ApiOrgGroupCollaboratorsOptions,
): ApiOrgGroupCollaborators {
  const logger = createLogger(`${options.processName}:org-group`);

  const providers = AutomationProviderRegistryAdapter.create(
    options.encryption ?? new UnconfiguredApiCipher(),
  );

  const automation = composeApiAutomationApp({
    prisma: options.prisma,
    projects: options.projects,
    monitors: options.monitors,
    featureFlags: options.featureFlags,
    plans: options.plans,
    providers,
    unsubscribeSecret: options.unsubscribeSecret,
    baseHost: options.baseHost,
    redis: options.redis,
    processName: options.processName,
  });

  const projectApp = ProjectApp.create({
    projects: options.projects,
    apiKeys: options.apiKeys,
    share: options.share,
    topics: options.topics,
    topicClustering: {
      requestClustering: () =>
        Promise.reject(
          new ApiCapabilityUnavailableError(
            "topic-clustering scheduler, so it cannot start a clustering run",
          ),
        ),
    } as Parameters<typeof ProjectApp.create>[0]["topicClustering"],
  });

  const codingAgentApp = composeCodingAgentApp(options);

  return {
    application: {
      automation,
      codingAgentApp,
      projects: projectApp,
      ...enterpriseApplication(options, logger),
    },
    organization: organizationPorts(options, logger),
    organizationAuditLogCheck: auditLogCheck(options.authz),
    project: projectPorts(options, logger),
    projectChecks: projectChecks(options.authz),
    codingAgents: codingAgentPorts(options),
    automation: {
      rateLimit: (input) => options.rateLimit(input),
      listSlackChannels: () =>
        Promise.reject(
          new ApiCapabilityUnavailableError(
            "Slack transport, so it cannot list a workspace's channels",
          ),
        ),
      providers: {
        actionParamsSchemaFor: (action) => providers.actionParamsSchemaFor(action),
        persistActionParamsFor: (action, args) => providers.persistActionParamsFor(action, args),
        redactActionParamsFor: (action, params) =>
          providers.redactActionParamsFor(action, params),
        decryptSlackBotToken: (actionParams) => providers.decryptSlackBotToken(actionParams),
        decryptWebhookHeaders: (stored) => providers.decryptWebhookHeaders(stored),
        decryptWebhookSigningSecrets: (stored) => providers.decryptWebhookSigningSecrets(stored),
      },
    },
    emailSuppression: {
      clientIp: (ctx) => (ctx as { clientIp?: () => string }).clientIp?.(),
      rateLimit: (input) => options.rateLimit(input),
      recordAudit: async (entry) => {
        await options.audit?.record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
            ...((entry.args ?? {}) as Record<string, unknown>),
          },
          error: null,
        });
      },
    },
    enterprise: enterprisePorts(options, logger),
  };
}

/**
 * The forty-six answers `organization.*` needs from this deployment.
 *
 * Three groups, and the split is the point. The row reads and the permission
 * probes run on this process's own connection and its one AuthZ service; the
 * rules that MOVED — the seat constraints, the role-naming convention, the
 * invitation display status, the team enrichment — are imported from
 * `@langwatch/organization-server` rather than restated; and the invitation
 * COMMANDS come from a port, because the service behind them has not moved.
 */
function organizationPorts(
  options: ApiOrgGroupCollaboratorsOptions,
  logger: Logger,
): OrganizationTrpcPorts<typeof signUpDataSchema> {
  const { prisma, authz } = options;
  // Injected wins, so a host that composed its own invitation service keeps
  // it. Otherwise this process composes one over its own graph, and only a
  // process missing the grant ledger or the role service still refuses.
  const invites =
    options.invites ??
    (options.authzGrants && options.roles
      ? composeApiOrganizationInvites({
          prisma,
          grants: options.authzGrants,
          roles: options.roles,
          plans: options.plans,
          rateLimit: (input) => options.rateLimit(input),
          baseHost: options.baseHost,
        }).trpc
      : undefined);
  const refuseInvitations = (what: string): Promise<never> =>
    Promise.reject(new ApiCapabilityUnavailableError(`invitation service, so it cannot ${what}`));
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
    decryptStoredSecret: (value) => decryptStoredSecret(options, value),

    /**
     * Both Enterprise plan gates, over the ONE plan provider this process
     * resolves every allowance through. `assertEnterprisePlanType` is the same
     * fail-closed equality test the platform ran: anything that is not
     * `ENTERPRISE` is refused, including a tier this build does not know.
     */
    assertCustomRolesAllowed: async (_ctx, { organizationId }) => {
      const plan = await options.plans.getActivePlan({ organizationId });
      assertEnterprisePlanType({
        planType: plan.type,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    },
    assertAuditLogsAllowed: async (_ctx, { organizationId }) => {
      const plan = await options.plans.getActivePlan({ organizationId });
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
      const enterprise = options.enterprise;
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
        new ApiCapabilityUnavailableError(
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
function auditLogCheck(authz: AuthzService): unknown {
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the audit-log read is authorized at the organization tier the query is anchored on, never the optional project filter",
      permissions: ["auditLog:view"],
    },
    async (params: never) => {
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
    },
  );
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

/**
 * `project.create`'s tier resolution and the trace-sharing demand.
 *
 * `create` names two tiers and acts on exactly one, decided by what was asked
 * for; the trace-sharing flip is a SECOND demand on top of the declared
 * `project:update`, applied after it, because it changes who outside the
 * project may read its traces.
 */
function projectChecks(authz: AuthzService): ProjectTrpcChecks {
  const probeTeam = (userId: string, permission: AuthzPermission, teamId: string) =>
    authz.hasPermission({ userId, permission, teamId });
  const probeOrganization = (userId: string, permission: AuthzPermission, organizationId: string) =>
    authz.hasPermission({ userId, permission, organizationId });
  const probeProject = (userId: string, permission: AuthzPermission, projectId: string) =>
    authz.hasPermission({ userId, permission, projectId });

  return {
    create: declareAuthzMiddleware(
      {
        kind: "custom",
        reason:
          "creating into an existing team asks that team; creating a team alongside asks the organization",
        permissions: ["project:create", "organization:manage"],
      },
      async (params: never) => {
        const call = params as unknown as ScopeCheckParams<{
          organizationId: string;
          teamId?: string;
          newTeamName?: string;
        }>;
        const userId = call.ctx.actor().id;
        if (!call.input.teamId && !call.input.newTeamName) {
          throw new ProjectCreateTargetMissingError();
        }
        const permitted = call.input.teamId
          ? await probeTeam(userId, "project:create", call.input.teamId)
          : await probeOrganization(userId, "organization:manage", call.input.organizationId);
        if (!permitted) throw new ProjectCreateDeniedError();
        call.ctx.permissionChecked = true;
        return call.next();
      },
    ),
    traceSharing: async (params: unknown) => {
      const call = params as ScopeCheckParams<{
        projectId: string;
        traceSharingEnabled?: boolean;
      }>;
      if (call.input.traceSharingEnabled !== undefined) {
        const permitted = await probeProject(
          call.ctx.actor().id,
          "project:manage",
          call.input.projectId,
        );
        if (!permitted) throw new TraceSharingDeniedError();
      }
      return call.next();
    },
  };
}

/** A create named neither an existing team nor a new one. */
class ProjectCreateTargetMissingError extends HandledError {
  declare readonly code: "validation_error";

  constructor() {
    super("validation_error", "Either an existing team or a new team name must be given", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ProjectCreateTargetMissingError";
  }
}

/** The caller may not create a project at the tier they named. */
class ProjectCreateDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to create a project here", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ProjectCreateDeniedError";
  }
}

/** The caller may update the project but not change who outside it can read. */
class TraceSharingDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to change trace sharing settings", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "TraceSharingDeniedError";
  }
}

/** The six answers `project.*` needs that the project does not own. */
function projectPorts(
  options: ApiOrgGroupCollaboratorsOptions,
  logger: Logger,
): ProjectTrpcMountPorts {
  return {
    encryptProjectSecret: (value) => {
      const encryption = options.encryption;
      if (!encryption) {
        throw new ApiCapabilityUnavailableError(
          "stored-secret key, so it cannot store a project's object-storage credentials",
        );
      }
      return encryption.encrypt(value);
    },
    probeProjectPermission: (ctx, projectId, permission) =>
      options.authz.hasPermission({ userId: actorId(ctx), permission, projectId }),
    getFieldProtections: (ctx, input) => {
      const protections = options.viewerProtections;
      if (!protections) {
        return Promise.reject(
          new ApiCapabilityUnavailableError(
            "content-protections resolver, so it cannot say what this viewer may read of a project",
          ),
        );
      }
      return protections.getViewerProtections(ctx, input);
    },
    /**
     * Best effort by the port's own contract: a project is created whether or
     * not Langy gets a key, and the credential service mints one on the first
     * chat call. So an absent gateway logs rather than refusing — refusing
     * would cost somebody the project they just created.
     */
    provisionLangyVirtualKey: (_ctx, input) => {
      logger.debug(
        { projectId: input.projectId },
        "no gateway virtual-key provisioner is composed: this project starts without a Langy key, and one is minted on its first chat call",
      );
      return Promise.resolve();
    },
    recordApiKeyRegenerated: async ({ userId, projectId }) => {
      await options.audit?.record({
        actorId: userId,
        path: "project.apiKey.regenerated",
        input: { projectId },
        error: null,
      });
    },
    reportTopicClusteringFailure: (error, context) => {
      logger.error({ error, projectId: context.projectId }, "a clustering request failed");
    },
  } as ProjectTrpcMountPorts;
}

/**
 * What one viewer may see of one project: whether captured content is readable,
 * and whether spend is.
 *
 * It THROWS when the policy cannot be resolved, which the coding-agent package
 * reads as "not visible" on the pull-request path — so an absent resolver
 * withholds titles and costs rather than showing them.
 */
function codingAgentPorts(options: ApiOrgGroupCollaboratorsOptions): CodingAgentTrpcPorts {
  return {
    readViewerVisibility: async (request, input): Promise<CodingAgentViewerVisibility> => {
      const resolver = options.viewerProtections;
      if (!resolver) {
        throw new ApiCapabilityUnavailableError(
          "content-protections resolver, so it cannot say what this viewer may read of a coding-agent session",
        );
      }
      const protections = await resolver.getViewerProtections(request, input);
      return {
        canReadCapturedContent:
          protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true,
        canSeeCosts: protections.canSeeCosts === true,
      };
    },
  };
}

/**
 * The coding-agent application, over this process's own ClickHouse and the
 * GitHub App it was configured with.
 *
 * `clickHouse: null` is a supported shape rather than a degradation: a session
 * is a ClickHouse projection, and a deployment holding no trace storage holds
 * no session to read. The package's own null repositories answer emptily.
 */
function composeCodingAgentApp(options: ApiOrgGroupCollaboratorsOptions): CodingAgentApp {
  const runtime = CodingAgentRuntime.create({
    projections: CodingAgentProjectionPersistenceAdapter.create({
      clickHouse: options.codingAgentClickHouse,
      retention: { defaultTraceRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS },
    }),
    github: options.github,
    projects: options.projects,
    billing: new ApiCodingAgentBilling(),
  });

  const scope = CodingAgentCallerScopeService.create({
    directory: new ApiCodingAgentScopeDirectory(options.prisma),
    permissions: new ApiCodingAgentScopePermissions(options.authz),
  });

  return CodingAgentApp.create({
    codingAgents: runtime.service,
    github: options.github,
    scope: {
      tryResolveOrganizationForProject: async (projectId) => {
        try {
          return await options.projects.getOrganizationId(projectId);
        } catch {
          return undefined;
        }
      },
      resolveCallerProjectScope: (input) => scope.resolve(input),
    },
  });
}

/**
 * The organization's projects and the person behind each personal workspace,
 * over this process's own connection.
 *
 * Composed here rather than inside the feature package because the package
 * declares no Prisma dependency, and this is the connection every other row
 * read on this process already runs on.
 */
export class ApiCodingAgentScopeDirectory extends CodingAgentCallerScopeDirectoryPort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  listOrganizationProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]> {
    return this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true, name: true, slug: true, teamId: true, isPersonal: true },
    });
  }

  async listPersonalTeamOwnerNames({
    teamIds,
  }: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (teamIds.length === 0) return new Map();
    const members = await this.prisma.teamUser.findMany({
      where: { teamId: { in: [...teamIds] } },
      select: { teamId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    const names = new Map<string, string>();
    for (const member of members) {
      if (names.has(member.teamId)) continue;
      // The schema has no foreign keys, so a membership row can outlive its
      // user; a missing user names nothing rather than failing the read.
      const label = member.user?.name?.trim() || member.user?.email?.trim();
      if (label) names.set(member.teamId, label);
    }
    return names;
  }
}

/**
 * The two permission cuts, over the ONE AuthZ service this process decides
 * with, in ONE batched ask.
 *
 * `canBatchPermissionsByIds` collects the principal's grant snapshot once and
 * decides every (project, permission) pair against it in memory. The previous
 * shape asked per project per permission, which on a large organization is a
 * database pass per project per permission: the fan-out exhausted the
 * connection pool and turned the rollup into a 500.
 *
 * An API-key principal carries its own ceiling in the engine — the key's
 * bindings intersected with its holder's, and the key's alone when it owns
 * nobody — so a narrowed key is cut here exactly the way it is cut at every
 * other door, without this composition restating the rule.
 */
export class ApiCodingAgentScopePermissions extends CodingAgentScopePermissionsPort {
  constructor(private readonly authz: AuthzService) {
    super();
  }

  async projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>> {
    const { byPermission } = await this.authz.canBatchPermissionsByIds({
      principal:
        input.caller.kind === "user"
          ? { type: "user", id: input.caller.userId }
          : { type: "apiKey", id: input.caller.apiKeyId },
      permissions: [...input.permissions],
      organizationId: input.organizationId,
      teams: [],
      projects: input.projects.map((project) => ({
        projectId: project.id,
        teamId: project.teamId,
      })),
    });

    return new Map(
      input.permissions.map((permission) => [
        permission,
        new Set(
          [...(byPermission.get(permission)?.projects ?? new Map())]
            .filter(([, allowed]) => allowed)
            .map(([projectId]) => projectId),
        ),
      ]),
    );
  }
}

/**
 * The two Enterprise ports, and the two refusals that stand in for them.
 *
 * The SCIM plan gate is answered for real — it is a read against the ONE plan
 * provider this process resolves every allowance through — while the back
 * office's connection ledger comes from the Enterprise application, because a
 * single sign-on connection is an Enterprise resource with an Enterprise
 * lifecycle. With none composed, every command on it refuses by name.
 */
function enterprisePorts(
  options: ApiOrgGroupCollaboratorsOptions,
  logger: Logger,
): EnterpriseTrpcMountPorts {
  return {
    scimToken: {
      requireEnterprisePlan: async ({ planProvider, organizationId }) => {
        const plan = await planProvider.getActivePlan({ organizationId });
        assertEnterprisePlanType({
          planType: plan.type,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
        });
      },
    },
    ssoConnections: {
      backoffice: () => {
        const enterprise = options.enterprise;
        if (!enterprise) {
          return unavailableSsoBackoffice();
        }
        return enterprise.backoffice();
      },
      recordAudit: async (entry) => {
        await options.audit?.record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            ...entry.args,
            targetKind: entry.targetKind,
            ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
          },
          error: null,
        });
        logger.debug({ action: entry.action }, "recorded a single sign-on back-office command");
      },
    },
  } as EnterpriseTrpcMountPorts;
}

/**
 * The single sign-on ledger, absent.
 *
 * Every one of its eleven commands refuses by name rather than one of them
 * answering emptily: an operator reading an empty connection list would
 * conclude this deployment has no federated tenants, which is a different
 * statement from "this process cannot see them".
 */
function unavailableSsoBackoffice(): ReturnType<
  EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]
> {
  const refuse = (): never => {
    throw new ApiCapabilityUnavailableError(
      "Enterprise single sign-on ledger, so it can neither read nor command a connection",
    );
  };
  return new Proxy({} as never, { get: () => refuse, has: () => true });
}

/**
 * The three Enterprise `ctx.app` slices, or a refusal per capability.
 *
 * A refusing application rather than an absent one, because the four
 * namespaces MOUNT either way: a client asking what its licence allows has to
 * be told this deployment cannot answer, and a namespace that simply is not
 * there tells it nothing at all.
 */
function enterpriseApplication(
  options: ApiOrgGroupCollaboratorsOptions,
  logger: Logger,
): Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits"> {
  const enterprise = options.enterprise;
  if (enterprise) return enterprise.application;

  logger.info(
    {},
    "API composed no Enterprise application: the licence, licence-enforcement, SCIM-token and single sign-on surfaces mount and refuse by name",
  );

  const refuse = (capability: string) =>
    new Proxy({} as never, {
      get: () => () => {
        throw new ApiCapabilityUnavailableError(capability);
      },
      has: () => true,
    });

  return {
    licensing: refuse("Enterprise licence store, so it cannot read or write an instance licence"),
    scimApp: refuse("Enterprise SCIM application, so it can neither list nor mint a token"),
    usageLimits: refuse("Enterprise usage-limit store, so it cannot report a limit"),
  } as Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
}

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

/** The deployment's stored-secret cipher, or a refusal that names the variable. */
class UnconfiguredApiCipher {
  encrypt(): never {
    throw new ApiCapabilityUnavailableError(
      "stored-secret key (CREDENTIALS_SECRET), so it cannot store an automation credential",
    );
  }

  decrypt(): never {
    throw new ApiCapabilityUnavailableError(
      "stored-secret key (CREDENTIALS_SECRET), so it cannot read an automation credential",
    );
  }
}

function decryptStoredSecret(options: ApiOrgGroupCollaboratorsOptions, value: string): string {
  const encryption = options.encryption;
  if (!encryption) {
    throw new ApiCapabilityUnavailableError(
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

/**
 * Overlays the org-group half onto whatever collaborator set the process
 * holds.
 *
 * Merged rather than replacing, and the application slice merged field by
 * field, for the reason `ApiTrpcCollaborators.application` states: a request
 * carries ONE application, and a process that could hand a different `projects`
 * to the project surface than to the flag resolution beside it would have two.
 *
 * `projects` is DELIBERATELY written here rather than by the product-group
 * half. That half holds the narrow organization read the flag surface
 * declared; this one holds the whole project application `project.*` writes
 * through, and it satisfies the narrow read as well. Two would let the
 * settings form and the flag resolution disagree about which organization a
 * project belongs to.
 */
export function withApiOrgGroupCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  group: ApiOrgGroupCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!base || !group) return base;
  return {
    ...base,
    organization: group.organization,
    organizationAuditLogCheck: group.organizationAuditLogCheck,
    project: group.project,
    projectChecks: group.projectChecks,
    codingAgents: group.codingAgents,
    automation: group.automation,
    emailSuppression: group.emailSuppression,
    enterprise: group.enterprise,
    application: {
      ...base.application,
      ...group.application,
    },
  } as unknown as AnyApiTrpcCollaborators;
}
