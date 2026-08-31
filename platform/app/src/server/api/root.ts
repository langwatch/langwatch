import { activityMonitorRouter } from "./routers/governance/activityMonitor";
import { aiToolsRouter } from "./routers/governance/aiTools";
import { anomalyRulesRouter } from "./routers/governance/anomalyRules";
import { governanceRouter } from "./routers/governance/governance";
import { ingestionSourcesRouter } from "./routers/governance/ingestionSources";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  createAuthzTrpcRouter,
  createAutomationTrpcRouter,
  createCodingAgentTrpcRouter,
  createEmailSuppressionTrpcRouter,
  createExportTrpcRouter,
  createGatewayTrpcRouters,
  createHomeTrpcRouter,
  createHttpProxyTrpcRouter,
  createLimitsTrpcRouter,
  createOpsTrpcRouter,
  createOrganizationTrpcRouter,
  createPersonalWorkspaceFeaturesTrpcRouter,
  createPinnedTraceTrpcRouter,
  createPlanTrpcRouter,
  createPromptTagTrpcRouter,
  createPromptTrpcRouter,
  createSavedViewTrpcRouter,
  createScenarioTrpcRouter,
  createSharedTraceTrpcRouter,
  createShareTrpcRouter,
  createSpansTrpcRouter,
  createStoredObjectTrpcRouter,
  createSuiteTrpcRouter,
  createTraceEditOverlayTrpcRouter,
  createTracesTrpcRouter,
  createTracesV2TrpcRouter,
  createTranslateTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyKit,
  type GatewayTrpcPorts,
} from "@langwatch/platform-api/app-trpc";
import {
  appTrpcNoPermissionPolicy,
  appTrpcPolicy,
  appTrpcServiceAuthorizedPolicy,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/api/trpc";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { fireScenarioCreatedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import { afterPromptCreated } from "~/server/app-layer/billing/nurturing/promptCreation";
import { prisma } from "~/server/db";
import { trackServerEvent } from "~/server/posthog";
import { captureException } from "~/utils/posthogErrorCapture";
import { appTrpcRoot } from "./trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "./trpc.runtime-policy";
import { scopeLineageGuard } from "./trpc.scope-lineage-middleware";
import {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  EnterpriseGatewayTrpcComposition,
  EnterpriseGovernanceTrpcComposition,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
} from "@langwatch/enterprise-api";
import { evaluatorsSchema } from "@langwatch/evaluator-contract";
import { z } from "zod";
import {
  buildPreconditionTraceDataFromTrace,
  checkEvaluatorRequiredFields,
  evaluatePreconditions,
} from "~/server/evaluations/preconditions";
import { checkPreconditionSchema } from "~/server/evaluations/types";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import { redactPatchForViewer } from "~/server/traces/edit-overlay/redactTraceEditOverlayPatch";
import { restoreWithheldEdits } from "~/server/traces/edit-overlay/restoreWithheldTraceEdits";
import { getAllForProjectInput, tracesFilterInput } from "./routers/traces.schemas";
import type { TRPCContext } from "./trpc.context";
import { getUserProtectionsForProject } from "./utils";
import { virtualKeyBudgetInputSchema } from "~/server/gateway/virtualKey.service";
import { env } from "~/env.mjs";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  identityEmail,
  joinRequestsService,
  ssoConnections,
} from "~/server/app-layer/identity/runtime";
import { SsoConnectionBackofficeService } from "~/server/app-layer/identity/sso-connection-backoffice.service";
import { systemMigrationsService } from "~/server/app-layer/system-migrations/runtime";
import { resolveHotDays, TABLE_TTL_CONFIG } from "~/server/clickhouse/ttlReconciler";
import {
  getEventSubscriberMetadata,
  getProjectionMetadata,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import { grafanaConfigFromEnv } from "~/utils/grafanaLinks";
import {
  assertEnterprisePlan,
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/enterprise-plan-gate";
// `isCustomRole` is a role-NAMING convention, not an entitlement, which is why
// it stays behind when the plan gate leaves.
import { isCustomRole } from "./enterprise";
import {
  batchScopePermissions,
  checkOpsPermission,
  checkOrganizationPermission,
  checkProjectPermission,
  type PermissionMiddlewareParams,
} from "./rbac";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import { fireTeamMemberInvitedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/server/app-layer/billing/nurturing/inviteAcceptance";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import { MemberSeatLimitReachedError } from "~/server/app-layer/organizations/errors";
import { enrichTeamWithRoleBindings } from "~/server/app-layer/organizations/organization.service";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import { assertInviteSendAllowed } from "~/server/invites/invite-send-throttle";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  OrganizationNotFoundError,
} from "~/server/invites/errors";
import {
  InviteService,
  maskInvitedAddress,
  matchInviteToAcceptor,
  resolveInviteDisplayStatus,
} from "~/server/invites/invite.service";
import type { LimitType } from "@langwatch/enterprise-billing-contract";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import {
  assertExternalTeamRoleChangeWithinSeatLimits,
  LICENSE_LIMIT_ERRORS,
} from "~/server/license-enforcement/license-limit-guard";
import { assertNoPersonalTeamScope } from "~/server/role-bindings/personal-team-scope";
import { signUpDataSchema } from "~/server/schemas/sign-up-data.schema";
import { decrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { toError } from "~/utils/posthogErrorCapture";
import { agentsRouter } from "~/runtime/app/internal-api/agents.router";
import { analyticsRouter } from "./routers/analytics";
import { annotationRouter } from "./routers/annotation";
import { annotationScoreRouter } from "./routers/annotationScore";
import { apiKeyRouter } from "./routers/apiKey";
import type { SlackActionParams } from "@langwatch/automation-contract";
import { PostgresSavedViewAdapter } from "@langwatch/dashboard-server";
import { createSharedTraceTrpcPorts, createTracesV2TrpcPorts } from "~/runtime/app/features/trace";
import { canReadCapturedContent } from "@langwatch/trace-server";
import { DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { listSlackChannels } from "~/runtime/app/features/automation-adapters/delivery/slackWebApi";
import {
  actionParamsSchemaFor,
  automationWebhookProvider,
  persistActionParamsFor,
  redactActionParamsFor,
} from "~/runtime/app/features/automation-adapters/providers/registry";
import { decryptSlackBotToken } from "~/runtime/app/features/automation-adapters/providers/slack/server";
import { RecentItemsService } from "~/server/home/recent-items.service";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";
import { wrapAiCall } from "~/server/modelProviders/aiCallFailedError";
import { rateLimit } from "~/server/rateLimit";
import { CollectorSpanUtils } from "~/server/traces/collectorSpan.utils";
import { getClientIp } from "~/utils/getClientIp";
import { batchRecordRouter } from "~/runtime/app/internal-api/batch-record.router";
import { bugReportsRouter } from "./routers/bugReports";
import { costsRouter } from "./routers/costs";
import { currencyRouter } from "./routers/currency";
import { dashboardsRouter } from "./routers/dashboards";
import { dataPrivacyRouter } from "./routers/dataPrivacy";
import { dataRetentionRouter } from "~/runtime/app/internal-api/data-retention.router";
import { datasetRouter } from "~/runtime/app/internal-api/dataset.router";
import { datasetRecordRouter } from "~/runtime/app/internal-api/dataset-record.router";
import { evaluationsRouter } from "./routers/evaluations";
import { evaluatorsRouter } from "~/runtime/app/internal-api/evaluator.router";
import { experimentsRouter } from "./routers/experiments";
import { featureFlagRouter } from "~/runtime/app/internal-api/feature-flag.router";
import { frontDoorRouter } from "./routers/frontDoor";
import { githubRouter } from "~/runtime/app/internal-api/github.router";
import { graphsRouter } from "./routers/graphs";
import { groupRouter } from "./routers/group";
import { identityRouter } from "./routers/identity";
import { integrationsChecksRouter } from "./routers/integrationsChecks";
import { joinRequestsRouter } from "./routers/joinRequests";
import { langyRouter } from "~/runtime/app/internal-api/langy.router";
import { langyEgressRouter } from "~/runtime/app/internal-api/langy.router";
import { llmModelCostsRouter } from "~/runtime/app/internal-api/model-provider.router";
import { modelProviderRouter } from "~/runtime/app/internal-api/model-provider.router";
import { monitorsRouter } from "~/runtime/app/internal-api/monitor.router";
import { onboardingRouter } from "./routers/onboarding/onboarding.router";
import { presenceRouter } from "~/runtime/app/internal-api/presence.router";
import { projectRouter } from "~/runtime/app/internal-api/project.router";
import { publicEnvRouter } from "./routers/publicEnv";
import { roleBindingRouter } from "~/runtime/app/internal-api/role-binding.router";
import { roleRouter } from "~/runtime/app/internal-api/role.router";
import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";
import { setupSkillsRouter } from "./routers/setupSkills";
import { teamRouter } from "~/runtime/app/internal-api/team.router";
import { topicsRouter } from "~/runtime/app/internal-api/topic.router";
import { userRouter } from "./routers/user";
import { optimizationRouter, workflowRouter } from "./routers/workflows";

/** This process's concrete policy chain, in the order the mounts apply it. */
const appTrpcMiddlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

/** What every package-owned mount needs from this process. */
const appTrpcMount = {
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares: appTrpcMiddlewares,
};

const shareRouter = createShareTrpcRouter(appTrpcMount);
const exportRouter = createExportTrpcRouter(appTrpcMount);
const pinnedTraceRouter = createPinnedTraceTrpcRouter(appTrpcMount);
const suiteRouter = createSuiteTrpcRouter(appTrpcMount);
const storedObjectsRouter = createStoredObjectTrpcRouter(appTrpcMount);
const promptTagsRouter = createPromptTagTrpcRouter(appTrpcMount);
const savedViewsRouter = createSavedViewTrpcRouter({
  ...appTrpcMount,
  ports: { savedViews: PostgresSavedViewAdapter.create({ database: prisma }).build() },
});
const planRouter = createPlanTrpcRouter(appTrpcMount);
const authzRouter = createAuthzTrpcRouter(appTrpcMount);
const personalWorkspaceFeaturesRouter = createPersonalWorkspaceFeaturesTrpcRouter(appTrpcMount);
const translateRouter = createTranslateTrpcRouter({ ...appTrpcMount, ports: { wrapAiCall } });

const recentItems = new RecentItemsService();

const homeRouter = createHomeTrpcRouter({
  ...appTrpcMount,
  ports: {
    getRecentItems: (_ctx, input) => recentItems.getRecentItems(input),
  },
});

const limitsRouter = createLimitsTrpcRouter({
  ...appTrpcMount,
  ports: {
    getUsageStats: (_ctx, input) =>
      UsageStatsService.create(prisma).getUsageStats(input.organizationId, input.user),
    checkAndSendWarning: (ctx, input) =>
      (ctx as TRPCContext).app.usageLimits.checkAndSendWarning(input),
  },
});

/**
 * The provider registry, the shared counter and the Slack listing: the three
 * capabilities the automation transport reaches that automation does not own.
 * Each needs this deployment's encryption key, its Redis, or its SSRF policy.
 * The provider entries are lambdas because `automationWebhookProvider` is a
 * class instance and an unbound method would lose its `this`.
 */
const automationRouter = createAutomationTrpcRouter({
  ...appTrpcMount,
  ports: {
    rateLimit,
    listSlackChannels,
    providers: {
      actionParamsSchemaFor,
      persistActionParamsFor: (action, args) => persistActionParamsFor(action, args),
      redactActionParamsFor,
      decryptSlackBotToken: (actionParams) =>
        decryptSlackBotToken((actionParams ?? {}) as SlackActionParams),
      decryptWebhookHeaders: (stored) => automationWebhookProvider.decryptHeaders(stored),
      decryptWebhookSigningSecrets: (stored) =>
        automationWebhookProvider.decryptSigningSecrets(stored),
    },
  },
});

/**
 * The unsubscribe pair arrives from a mail client, so it needs the process's
 * unauthenticated procedure — the same one `publicProcedure` is built from,
 * which is what keeps `isPublicProcedure` recognising it.
 */
const emailSuppressionRouter = createEmailSuppressionTrpcRouter({
  ...appTrpcMount,
  publicProcedure: appTrpcRoot.procedure,
  ports: {
    clientIp: (ctx) => getClientIp((ctx as TRPCContext).req),
    rateLimit,
    recordAudit: (entry) => auditLog(entry),
  },
});

/**
 * What one viewer may see of one project, resolved from the project's
 * protections by the functions that own each rule: content visibility by
 * `canReadCapturedContent`, spend by the `cost:view` cut the protections
 * already carry. It THROWS when the policy cannot be resolved, which the
 * coding-agent package reads as "not visible" — do not give it a default.
 */
const codingAgentViewerVisibility = async (
  request: unknown,
  { projectId }: { projectId: string },
) => {
  const protections = await getUserProtectionsForProject(request as TRPCContext, { projectId });
  return {
    canReadCapturedContent: canReadCapturedContent(protections),
    canSeeCosts: protections.canSeeCosts === true,
  };
};

const codingAgentsRouter = createCodingAgentTrpcRouter({
  ...appTrpcMount,
  ports: {
    // The organization lookup and the caller's project scope moved onto
    // `CodingAgentApp`, which the transport reaches at `ctx.app.codingAgentApp`.
    // Only the viewer's visibility is still the process's to supply.
    readViewerVisibility: codingAgentViewerVisibility,
  },
});

const httpProxyRouter = createHttpProxyTrpcRouter({
  ...appTrpcMount,
  ports: {
    postStudioEvent: async (request, { projectId, event, onEvent }) => {
      const ctx = request as TRPCContext;
      await studioBackendPostEvent({
        projectId,
        nlpLambda: ctx.app.nlpLambda,
        modelProviders: ctx.app.modelProviders.providerService,
        message: await ctx.app.workflows.prepareStudioEvent({ event, projectId }),
        onEvent,
      });
    },
    // The span is the agent feature's; the OTLP conversion and the collector
    // are this process's, so the write is split at exactly that seam.
    recordAgentTestTrace: async (request, { projectId, trace }) => {
      const ctx = request as TRPCContext;
      await ctx.app.commands.traces.recordSpan({
        tenantId: projectId,
        span: CollectorSpanUtils.convertSpanToOtlp(trace.span),
        resource: CollectorSpanUtils.buildResource({
          reservedTraceMetadata: { user_id: trace.userId },
          customMetadata: trace.customMetadata,
          expectedOutput: null,
        }),
        instrumentationScope: { name: "langwatch.agent_test" },
        // Resolved downstream in the recordSpan pipeline from the scoped
        // data-privacy policy; ingestion passes the essential default
        // (#4729 removed Project.piiRedactionLevel).
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
        occurredAt: trace.occurredAt,
      });
    },
  },
});

/**
 * The audit-log read authorizes at the ORGANIZATION tier, always.
 *
 * A bare `.permission("auditLog:view")` cannot express this: `auditLog` is
 * grantable at project/team/organization, and the declared check resolves to
 * the narrowest tier whose id the input carries. Because `projectId` is an
 * optional filter here, supplying it would move the whole check to the
 * project tier and leave `input.organizationId` — the id the query is
 * anchored on — unauthorized. A caller holding `auditLog:view` on any one
 * project could then read a different organization's org-scoped audit trail.
 *
 * So the org id is checked unconditionally, and when a project filter is
 * present it is additionally checked at the project tier, so a project-scoped
 * grant cannot widen a read to rows outside that project either.
 */
function checkAuditLogPermission() {
  const organizationCheck = checkOrganizationPermission("auditLog:view");
  const projectCheck = checkProjectPermission("auditLog:view");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the audit-log read is authorized at the organization tier the query is anchored on, never the optional project filter",
      permissions: ["auditLog:view"],
    },
    async (
      params: PermissionMiddlewareParams<{
        organizationId: string;
        projectId?: string;
      }>,
    ) => {
      const { projectId } = params.input;
      if (!projectId) return organizationCheck(params);
      return organizationCheck({
        ...params,
        next: () => projectCheck({ ...params, input: { projectId } }),
      });
    },
  );
}

/** The request app, as the organization ports read it off the tRPC context. */
const organizationCtx = (ctx: unknown) => ctx as TRPCContext;

/** The invitation service, built per call against the request's Prisma. */
const invitesFor = (ctx: unknown) => {
  const app = organizationCtx(ctx);
  return InviteService.create(app.prisma, { mailer: app.app.mailer });
};

const organizationRouter = createOrganizationTrpcRouter({
  ...appTrpcMount,
  auditLogCheck: checkAuditLogPermission(),
  ports: {
    signUpDataSchema,

    probeOrganizationPermission: (ctx, organizationId, permission) =>
      probeOrganizationPermission(organizationCtx(ctx), organizationId, permission),
    batchProjectPermissions: async (ctx, input) =>
      (
        await batchScopePermissions(organizationCtx(ctx), {
          organizationId: input.organizationId,
          teamIds: [],
          projectIds: input.projectIds,
          projectTeamId: input.projectTeamId,
          permission: input.permission,
        })
      ).projects,
    listBindingsForSynthesis: (ctx, input) =>
      organizationCtx(ctx).app.permissions.listBindingsForSynthesis(input),
    enrichTeamWithRoleBindings,

    demoProject: () => ({
      userId: env.DEMO_PROJECT_USER_ID ?? "",
      projectId: env.DEMO_PROJECT_ID ?? "",
    }),
    decryptStoredSecret: decrypt,

    assertCustomRolesAllowed: async (ctx, { organizationId }) => {
      const app = organizationCtx(ctx);
      await assertEnterprisePlan({
        planProvider: app.app.planProvider,
        organizationId,
        user: app.session?.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });
    },
    assertAuditLogsAllowed: async (ctx, { organizationId }) => {
      const app = organizationCtx(ctx);
      await assertEnterprisePlan({
        planProvider: app.app.planProvider,
        organizationId,
        user: app.session?.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
      });
    },
    isCustomRole,

    fullMemberLimitMessage: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
    liteMemberViewerOnlyMessage: LITE_MEMBER_VIEWER_ONLY_ERROR,
    asMemberSeatLimitReached: (error) =>
      error instanceof MemberSeatLimitReachedError
        ? {
            limitType: error.meta.limitType,
            current: error.meta.current,
            max: error.meta.max,
          }
        : null,
    asResourceLimitExceeded: (error) =>
      error instanceof LimitExceededError
        ? {
            limitType: error.limitType,
            current: error.current,
            max: error.max,
            message: error.message,
          }
        : null,
    isOrganizationNotFound: (error) => error instanceof OrganizationNotFoundError,
    // `limitType` round-trips: it came off the same refusal a moment earlier
    // and is handed straight back to the notifier that raised it.
    notifyResourceLimitReached: (ctx, input) =>
      organizationCtx(ctx).app.usageLimits.notifyResourceLimitReached({
        ...input,
        limitType: input.limitType as LimitType,
      }),
    isTeamRoleAllowedForOrganizationRole: ({ organizationRole, teamRole }) =>
      isTeamRoleAllowedForOrganizationRole({
        organizationRole,
        teamRole: teamRole as TeamRoleValue,
      }),
    assertTeamRoleChangeWithinSeatLimits: async (ctx, input) => {
      const app = organizationCtx(ctx);
      await assertExternalTeamRoleChangeWithinSeatLimits({
        prisma: app.prisma,
        roles: app.app.roleService,
        planProvider: app.app.planProvider,
        organizationId: input.organizationId,
        teamId: input.teamId,
        userId: input.userId,
        actingUser: app.session?.user,
      });
    },
    assertNoPersonalTeamScope: async (ctx, { teamId }) => {
      await assertNoPersonalTeamScope({
        client: organizationCtx(ctx).prisma,
        scopes: [{ scopeType: RoleBindingScopeType.TEAM, scopeId: teamId }],
      });
    },
    tryGetTeamOrganizationId: async (ctx, { teamId }) => {
      const team = await organizationCtx(ctx).prisma.team.findUnique({
        where: { id: teamId },
        select: { organizationId: true },
      });
      return team?.organizationId ?? null;
    },
    tryGetOrganizationMemberRole: async (ctx, { organizationId, userId }) => {
      const membership = await organizationCtx(ctx).prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      });
      return membership?.role ?? null;
    },

    createInvites: (ctx, input) =>
      invitesFor(ctx).createInvites({
        organizationId: input.organizationId,
        invites: input.invites,
        user: organizationCtx(ctx).session?.user,
        // Lenient validation keeps this procedure's historical form
        // behavior: invalid teams and custom roles drop the assignment or
        // the invite quietly instead of refusing the batch.
        validation: "lenient",
      }),
    revokeInvite: async (ctx, input) => {
      await invitesFor(ctx).revokeInvite(input);
    },
    assertInviteSendAllowed: (_ctx, input) => assertInviteSendAllowed(input),
    resendInvite: (ctx, input) => invitesFor(ctx).resendInvite(input),
    buildInviteAcceptUrl,
    listInvites: (ctx, input) => invitesFor(ctx).listInvites(input),
    tryGetInviteByCode: (ctx, { inviteCode }) =>
      organizationCtx(ctx).prisma.organizationInvite.findUnique({
        where: { inviteCode },
        include: { organization: true },
      }),
    resolveInviteDisplayStatus,
    matchInviteToAcceptor: async (_ctx, { inviteEmail, sessionEmail, userId }) =>
      matchInviteToAcceptor({
        inviteEmail,
        sessionEmail,
        matchable: await identityEmail().tryVerifiedEmailsOf({ userId }),
      }),
    maskInvitedAddress,
    applyInvite: (ctx, { userId, invite, viaIdentifierId }) =>
      invitesFor(ctx).applyInvite({ userId, invite, viaIdentifierId }),
    findLandingProjectSlug: (ctx, { invite }) => invitesFor(ctx).findLandingProjectSlug(invite),
    inviteNotFoundError: () => new InviteNotFoundError("Invitation not found"),
    inviteExpiredError: () => new InviteExpiredError(),
    inviteWrongAccountError: (maskedEmail) => new InviteWrongAccountError(maskedEmail),
    inviteAlreadyAcceptedMessage: INVITE_ALREADY_ACCEPTED_MESSAGE,
    inviteNotReadyMessage: INVITE_NOT_READY_MESSAGE,

    resolveJoinRequestByInvitation: async (ctx, input) => {
      const app = organizationCtx(ctx);
      await joinRequestsService({
        authzGrants: app.app.authzGrants,
        featureFlags: app.app.featureFlags,
        mailer: app.app.mailer,
      }).resolveByInvitation(input);
    },
    withdrawJoinRequestOnInvitationAccepted: async (ctx, input) => {
      const app = organizationCtx(ctx);
      await joinRequestsService({
        authzGrants: app.app.authzGrants,
        featureFlags: app.app.featureFlags,
        mailer: app.app.mailer,
      }).withdrawOnInvitationAccepted(input);
    },
    tryFindUserIdByEmail: async (ctx, { email }) => {
      const user = await organizationCtx(ctx).prisma.user.findFirst({
        where: { email },
        select: { id: true },
      });
      return user?.id ?? null;
    },

    trackServerEvent,
    fireTeamMemberInvitedNurturing,
    fireInviteAcceptedNurturing: fireInviteAcceptedNurturingCalls,
    sendSlackSignupEvent: (ctx, input) =>
      organizationCtx(ctx).app.notifications.sendSlackSignupEvent(input),
    reportError: (error, context) => captureException(toError(error), context),
  },
});

/**
 * The caller's read-time redactions, resolved per request. Every trace
 * transport takes them and hands them straight to the read: they depend on the
 * session, the project's data-privacy policy and the plan's visibility window,
 * none of which the trace package owns.
 */
const traceViewerProtections = (ctx: TRPCContext, input: { projectId: string }) =>
  getUserProtectionsForProject(ctx, { projectId: input.projectId });

const spansRouter = createSpansTrpcRouter({
  ...appTrpcMount,
  ports: { getViewerProtections: traceViewerProtections },
});

const traceEditOverlayRouter = createTraceEditOverlayTrpcRouter({
  ...appTrpcMount,
  ports: {
    getViewerProtections: traceViewerProtections,
    redactPatchForViewer,
    restoreWithheldEdits,
  },
});

const tracesRouter = createTracesTrpcRouter({
  ...appTrpcMount,
  ports: {
    filterInputSchema: tracesFilterInput,
    listInputSchema: getAllForProjectInput,
    evaluatorTypeSchema: evaluatorsSchema.keyof().or(z.string().startsWith("custom/")),
    preconditionSchema: checkPreconditionSchema,
    getViewerProtections: traceViewerProtections,
    formatSpansDigest,
    checkEvaluatorRequiredFields,
    buildPreconditionTraceData: buildPreconditionTraceDataFromTrace,
    evaluatePreconditions,
  },
});

const tracesV2Router = createTracesV2TrpcRouter({
  ...appTrpcMount,
  ports: createTracesV2TrpcPorts(),
});

/**
 * ADR-057: the one anonymous trace read. It takes the process's PUBLIC
 * procedure — the same one `publicProcedure` is built from, so
 * `isPublicProcedure` still recognises it — and a `noPermission` declaration
 * rather than a permission: the share token in the input is the whole
 * authorization.
 */
const sharedTraceRouter = createSharedTraceTrpcRouter({
  ...appTrpcMount,
  publicProcedure: appTrpcRoot.procedure,
  ports: createSharedTraceTrpcPorts(),
});

const promptsRouter = createPromptTrpcRouter({
  ...appTrpcMount,
  ports: {
    // Fire-and-forget: nurturing may not fail a create.
    afterPromptCreated: ({ projectId, userId }) =>
      afterPromptCreated({ prisma, projectId, userId }),
  },
});

const scenarioRouter = createScenarioTrpcRouter({
  ...appTrpcMount,
  ports: {
    trackScenarioCreated: ({ userId, projectId }) =>
      trackServerEvent({ userId, event: "scenario_created", projectId }),
    fireScenarioCreatedNurturing,
    captureException,
  },
});

/**
 * The operator back office's policy in the kit form its mount needs. Its gate
 * is `checkOpsPermission`, a `kind: "custom"` declaration that resolves the
 * admin allow-list rather than reading a scope id out of the input, so the
 * process hands over the middleware itself instead of a description of it —
 * which is exactly what `declaredCheckFrom` refuses to build.
 */
const opsTrpcPolicy: AppTrpcPolicyKit = {
  tracerMiddleware,
  loggerMiddleware,
  handledErrorMiddleware,
  enforcePermissionCheck,
  auditLogMutations,
  scopeLineageGuard,
  checkDeclaredPermission,
  declaredNoPermission,
  checkOpsPermission,
};

const opsRouter = createOpsTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: opsTrpcPolicy,
  ports: {
    listPipelineRegistrations: () => ({
      projections: getProjectionMetadata(),
      eventSubscribers: getEventSubscriberMetadata(),
    }),
    getEventLogSearchWindow: () => {
      const ttl = TABLE_TTL_CONFIG.find((entry) => entry.table === "event_log");
      return {
        searchLookbackDays: 365,
        hotTierDays: ttl ? resolveHotDays(ttl) : null,
        hotTierEnvVar: ttl?.envVar ?? null,
      };
    },
    tryGetGrafanaLinkConfig: () => {
      const { baseUrl, tempoDatasourceUid, lokiDatasourceUid } = grafanaConfigFromEnv();
      if (!baseUrl) return null;
      return { baseUrl, tempoDatasourceUid, lokiDatasourceUid };
    },
    systemMigrations: systemMigrationsService,
  },
});

const noPermissionPolicy = appTrpcNoPermissionPolicy(appTrpcMiddlewares);

const enterpriseRouters = EnterpriseTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
  instanceLicensePolicy: noPermissionPolicy(INSTANCE_LICENSE_NO_PERMISSION),
  backOfficePolicy: noPermissionPolicy(BACK_OFFICE_NO_PERMISSION),
  backOfficePolicyForOrganization: noPermissionPolicy(BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION),
  saasBilling: env.IS_SAAS,
  ports: {
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
      backoffice: () => new SsoConnectionBackofficeService({ prisma, connections: ssoConnections }),
      recordAudit: auditLog,
    },
  },
});

/**
 * All that is left of the seam between the gateway transports and this
 * application.
 *
 * Everything else this bag carried — the visibility rules, the per-scope
 * checks, the DTO projections, the budget resolvers, the usage reads — now
 * lives on `GatewayApp`, which the routers reach at `ctx.app.gateway` and the
 * process composes once in `app-layer/presets.ts`. That composition is also
 * what the public REST family is given, so the two doors cannot enforce
 * different rules.
 *
 * The budget parser cannot follow it there. A tRPC procedure's input parser is
 * fixed when the router is BUILT and the application is a per-request value,
 * so this one member stays an argument.
 */
const gatewayTrpcPorts = {
  virtualKeys: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },
  // `satisfies`, not an annotation: an annotation would collapse the parser's
  // concrete type to the loose constraint and the router would lose the shape
  // its create and update inputs publish.
} satisfies GatewayTrpcPorts;

const gatewayRouters = createGatewayTrpcRouters({ ...appTrpcMount, ports: gatewayTrpcPorts });

const enterpriseGatewayRouters = EnterpriseGatewayTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
  resolverAuthorizedPolicy: appTrpcServiceAuthorizedPolicy(appTrpcMiddlewares),
});

const enterpriseGovernanceRouters = EnterpriseGovernanceTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
});

const coreRouters = {
  agents: agentsRouter,
  evaluators: evaluatorsRouter,
  httpProxy: httpProxyRouter,
  organization: organizationRouter,
  joinRequests: joinRequestsRouter,
  project: projectRouter,
  team: teamRouter,
  traces: tracesRouter,
  tracesV2: tracesV2Router,
  traceEditOverlay: traceEditOverlayRouter,
  codingAgents: codingAgentsRouter,
  spans: spansRouter,
  analytics: analyticsRouter,
  monitors: monitorsRouter,
  costs: costsRouter,
  plan: planRouter,
  presence: presenceRouter,
  topics: topicsRouter,
  dataset: datasetRouter,
  datasetRecord: datasetRecordRouter,
  graphs: graphsRouter,
  dashboards: dashboardsRouter,
  home: homeRouter,
  evaluations: evaluationsRouter,
  export: exportRouter,
  batchRecord: batchRecordRouter,
  limits: limitsRouter,
  automation: automationRouter,
  authz: authzRouter,
  identity: identityRouter,
  frontDoor: frontDoorRouter,
  experiments: experimentsRouter,
  featureFlag: featureFlagRouter,
  annotation: annotationRouter,
  modelProvider: modelProviderRouter,
  llmModelCost: llmModelCostsRouter,
  user: userRouter,
  bugReports: bugReportsRouter,
  ssoConnections: enterpriseRouters.ssoConnections,
  annotationScore: annotationScoreRouter,
  publicEnv: publicEnvRouter,
  setupSkills: setupSkillsRouter,
  share: shareRouter,
  sharedTrace: sharedTraceRouter,
  pinnedTrace: pinnedTraceRouter,
  dataRetention: dataRetentionRouter,
  emailSuppression: emailSuppressionRouter,
  dataPrivacy: dataPrivacyRouter,
  translate: translateRouter,
  workflow: workflowRouter,
  optimization: optimizationRouter,
  integrationsChecks: integrationsChecksRouter,
  onboarding: onboardingRouter,
  scenarios: scenarioRouter,
  suites: suiteRouter,
  role: roleRouter,
  prompts: promptsRouter,
  promptTags: promptTagsRouter,
  savedViews: savedViewsRouter,
  secrets: secretsRouter,
  license: enterpriseRouters.license,
  licenseEnforcement: enterpriseRouters.licenseEnforcement,
  scimToken: enterpriseRouters.scimToken,
  roleBinding: roleBindingRouter,
  apiKey: apiKeyRouter,
  group: groupRouter,
  ops: opsRouter,
  storedObjects: storedObjectsRouter,
  virtualKeys: gatewayRouters.virtualKeys,
  personalVirtualKeys: enterpriseGatewayRouters.personalVirtualKeys,
  personalWorkspaceFeatures: personalWorkspaceFeaturesRouter,
  routingPolicy: enterpriseGatewayRouters.routingPolicy,
  ingestionSources: ingestionSourcesRouter,
  activityMonitor: activityMonitorRouter,
  anomalyRules: anomalyRulesRouter,
  aiTools: aiToolsRouter,
  departments: enterpriseGovernanceRouters.departments,
  ingestionTemplates: enterpriseGovernanceRouters.ingestionTemplates,
  ingestionKey: enterpriseGovernanceRouters.ingestionKey,
  governance: governanceRouter,
  personalSessions: enterpriseGovernanceRouters.personalSessions,
  sessionPolicy: enterpriseGovernanceRouters.sessionPolicy,
  gatewayBudgets: gatewayRouters.gatewayBudgets,
  gatewayCacheRules: gatewayRouters.gatewayCacheRules,
  gatewayGuardrails: gatewayRouters.gatewayGuardrails,
  gatewayUsage: gatewayRouters.gatewayUsage,
  gatewaySpendEvents: gatewayRouters.gatewaySpendEvents,
  webhookEndpoints: enterpriseGatewayRouters.webhookEndpoints,
  github: githubRouter,
  langyEgress: langyEgressRouter,
  langy: langyRouter,
};

const eeRouters = {
  subscription: enterpriseRouters.subscription,
  currency: currencyRouter,
};

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  ...coreRouters,
  ...eeRouters,
});

// export type definition of API
export type AppRouter = typeof appRouter;
