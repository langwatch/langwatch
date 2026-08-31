import { governanceRouter } from "./routers/governance/governance";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  createAppTrpcFeatures,
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
import {
  fireScenarioCreatedNurturing,
  fireWorkflowCreatedNurturing,
} from "~/server/app-layer/billing/nurturing/featureAdoption";
import {
  fireIntegrationMethodNurturing,
  mapProductSelectionToIntegrationMethod,
} from "~/server/app-layer/billing/nurturing/productInterest";
import { afterPromptCreated } from "~/server/app-layer/billing/nurturing/promptCreation";
import { fireSignupNurturingCalls } from "~/server/app-layer/billing/nurturing/signupIdentification";
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
  CURRENCY_NO_PERMISSION,
  EnterpriseGatewayTrpcComposition,
  EnterpriseGovernanceTrpcComposition,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
} from "@langwatch/enterprise-api";
import {
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
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
  signInRouter,
  signUpVerification,
  ssoConnections,
  verificationCeremony,
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
  authorizeInResolver,
  batchScopePermissions,
  checkOpsPermission,
  checkOrganizationPermission,
  checkProjectPermission,
  type PermissionMiddlewareParams,
} from "./rbac";
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import {
  RoleBindingScopeType,
  type DataPrivacyPolicy as DataPrivacyPolicyRow,
  type PrismaClient,
} from "~/generated/prisma/client";
import { fireTeamMemberInvitedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/server/app-layer/billing/nurturing/inviteAcceptance";
import { deploymentOffersPasskeys } from "~/server/app-layer/identity/signin-method-policy";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import {
  MemberSeatLimitReachedError,
  NoAdminConfiguredError,
} from "~/server/app-layer/organizations/errors";
import { enrichTeamWithRoleBindings } from "~/server/app-layer/organizations/organization.service";
import {
  probeOrganizationPermission,
  probeProjectPermission,
} from "~/server/app-layer/permissions/imperative";
import { buildInviteAcceptUrl, buildMembersSettingsUrl } from "~/server/invites/invite-link";
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
import { timeseriesInput } from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { MAX_LWQL_LENGTH } from "~/server/analytics/lwql";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";
import {
  mapDashboardSavedWorkbenchChartError,
  validateSavedWorkbenchChartDefinition,
} from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import { availableFilters } from "~/server/filters/registry";
import { resolveLangWatchQLCaller } from "./routers/analytics/lwqlCaller";
import { enforceWorkbenchEnabled } from "./routers/analytics/workbenchAccessMiddleware";
import type { SlackActionParams, Trigger } from "@langwatch/automation-contract";
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
import { Auth0ApiError, changeAuth0Password } from "~/server/auth0/passwordService";
import {
  getAllBugReports,
  getBugReportById,
} from "~/server/app-layer/bug-reports/bug-report.service";
import {
  assertCanWriteDataPrivacyScope,
  assertScopeBelongsToProjectOrganization,
} from "~/server/data-privacy/dataPrivacyPolicy.authz";
import {
  getDataPrivacySnapshot,
  type DataPrivacySnapshot,
} from "~/server/data-privacy/dataPrivacyPolicy.read";
import {
  getDataPrivacyPolicyService,
  InvalidDataPrivacyConfigError as AppInvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError as AppScopeTargetNotFoundError,
} from "~/server/data-privacy/dataPrivacyPolicy.service";
import { RecentItemsService } from "~/server/home/recent-items.service";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";
import { sendBudgetIncreaseRequestEmail } from "~/server/mailer/budgetIncreaseRequestEmail";
import { wrapAiCall } from "~/server/modelProviders/aiCallFailedError";
import { OnboardingChecksService, type OnboardingCheckStatus } from "~/server/onboarding-checks";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";
import { resolveSupportContact } from "~/server/organizations/resolveSupportContact";
import { rateLimit } from "~/server/rateLimit";
import { CollectorSpanUtils } from "~/server/traces/collectorSpan.utils";
import { getClientIp } from "~/utils/getClientIp";
import { batchRecordRouter } from "~/runtime/app/internal-api/batch-record.router";
import { costsRouter } from "./routers/costs";
import { dataRetentionRouter } from "~/runtime/app/internal-api/data-retention.router";
import { datasetRouter } from "~/runtime/app/internal-api/dataset.router";
import { datasetRecordRouter } from "~/runtime/app/internal-api/dataset-record.router";
import { evaluatorsRouter } from "~/runtime/app/internal-api/evaluator.router";
import { featureFlagRouter } from "~/runtime/app/internal-api/feature-flag.router";
import { githubRouter } from "~/runtime/app/internal-api/github.router";
import { langyRouter } from "~/runtime/app/internal-api/langy.router";
import { langyEgressRouter } from "~/runtime/app/internal-api/langy.router";
import { llmModelCostsRouter } from "~/runtime/app/internal-api/model-provider.router";
import { modelProviderRouter } from "~/runtime/app/internal-api/model-provider.router";
import { monitorsRouter } from "~/runtime/app/internal-api/monitor.router";
import { presenceRouter } from "~/runtime/app/internal-api/presence.router";
import { projectRouter } from "~/runtime/app/internal-api/project.router";
import { roleBindingRouter } from "~/runtime/app/internal-api/role-binding.router";
import { roleRouter } from "~/runtime/app/internal-api/role.router";
import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";
import { setupSkillsRouter } from "./routers/setupSkills";
import { teamRouter } from "~/runtime/app/internal-api/team.router";
import { topicsRouter } from "~/runtime/app/internal-api/topic.router";
import type { resolveAnnotationSuggestionTarget } from "@langwatch/annotation-contract";
import {
  createOrUpdateQueueItems,
  PostgresAnnotationQueueAdapter,
} from "@langwatch/annotation-server";
import { AuthApp } from "@langwatch/auth-server";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { pMapLimited } from "@langwatch/eventing";
import { featureByKey } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { WorkflowVersionRequiredError, type StudioWorkflow } from "@langwatch/workflow-contract";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { compare, hash } from "bcrypt";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { resolveAuthProvider } from "~/runtime/app/features/sso";
import { getAzureSafetyEnvFromProject } from "~/server/app-layer/evaluations/azure-safety-env.server";
import { evaluatorUnavailability } from "~/server/evaluations/installedEvaluators";
import { runEvaluationForTrace } from "~/server/evaluations/runEvaluation";
import { workbenchStateSchema } from "~/server/experiments-v3/legacy-workbench.schema";
import { filterFieldsEnum } from "~/server/filters/types";
import { coerceMonitorMappings, mappingStateSchema } from "~/server/tracer/tracesMapping";
import { ClickHouseTraceService } from "~/server/traces/clickhouse-trace.service";
import { TraceEditOverlayService } from "~/server/traces/edit-overlay/traceEditOverlay.service";
import { slugify } from "~/utils/slugify";

/**
 * The `user.*` surface's own logger, kept under the name its lines have always
 * carried: a rename here would break every saved query that reads them.
 */
const userLogger = createLogger("langwatch:user-router");

/**
 * The Auth0 Management API's refusals, as outcomes. The user package turns each
 * one into the message the customer reads; anything that is not an Auth0
 * refusal keeps travelling as itself and degrades to an unknown error with a
 * trace id.
 *
 * The outcomes are `as const` rather than annotated with the package's own
 * union: naming that type here would mean importing a feature SERVER package
 * into the router root for a type alone, and the literal types the assertion
 * preserves are what the port checks its answer against anyway.
 */
function auth0Outcome(error: Auth0ApiError) {
  switch (error.code) {
    case "weak_password":
      return { outcome: "weak_password", message: error.message } as const;
    case "insufficient_scope":
      return { outcome: "insufficient_scope" } as const;
    case "password_grant_not_enabled":
      return { outcome: "password_grant_not_enabled" } as const;
    case "not_configured":
      return { outcome: "not_configured" } as const;
    default:
      return { outcome: "failed" } as const;
  }
}

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

/**
 * The setup rollup behind `integrationsChecks.getCheckStatus`.
 *
 * It stays here rather than in the project package because of what it reads:
 * nine other verticals' storage — workflows, custom graphs, datasets, online
 * evaluations, triggers, team members, model providers, simulations and
 * prompts — beside the project's own two columns. That fan-out is the
 * application's, exactly as the recent-items reader above it is.
 */
const onboardingChecks = new OnboardingChecksService();

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

/**
 * The sign-up questionnaire's answers, as this process reads them back.
 *
 * The onboarding transport carries them opaquely — the schema is this
 * process's, so the shape is not the feature package's to know — and every
 * consumer of them is on this side of the port.
 */
const asSignUpData = (value: unknown) => value as z.infer<typeof signUpDataSchema> | undefined;

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
  currencyPolicy: noPermissionPolicy(CURRENCY_NO_PERMISSION),
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

/** The slug `/annotations/<slug>` addresses, for a queue name. */
const toAnnotationQueueSlug = (name: string): string =>
  slugify(name.replace("_", "-"), { lower: true, strict: true });

/** The trace content behind a set of queue items, resolved in full (#4991). */
async function loadQueueItemTraces(
  ctx: TRPCContext,
  { projectId, traceIds }: { projectId: string; traceIds: readonly string[] },
) {
  const protections = await getUserProtectionsForProject(ctx, { projectId });
  // Annotators label trace content — resolve full IO (#4991) so they see the
  // whole value, not the 64 KB preview.
  return ctx.app.traces.readTracesWithSpans({
    projectId,
    traceIds: [...traceIds],
    protections,
  });
}

/** Writes one suggestion into the trace's correction, or takes it back off when
 *  the reviewer cleared the text. */
async function writeAnnotationSuggestionToOverlay({
  prisma: client,
  projectId,
  traceId,
  target,
  text,
  userId,
}: {
  prisma: PrismaClient;
  projectId: string;
  traceId: string;
  target: NonNullable<ReturnType<typeof resolveAnnotationSuggestionTarget>>;
  text: string;
  userId: string;
}): Promise<void> {
  const overlay = TraceEditOverlayService.create(client);
  const withdrawn = text.length === 0;
  if (target.kind === "span") {
    const span = { projectId, traceId, spanId: target.spanId, userId };
    await (withdrawn
      ? overlay.removeSpanFieldEdit({ ...span, field: target.field })
      : overlay.mergeSpanFieldEdit({ ...span, field: target.field, text }));
    return;
  }

  const trace = { projectId, traceId, field: target.field, userId };
  await (withdrawn
    ? overlay.removeTraceIOEdit(trace)
    : overlay.mergeTraceIOEdit({ ...trace, value: text }));
}

/** The sign-up ceremony, composed per request over this process's app. */
const signUp = (ctx: TRPCContext) => signUpVerification(ctx.app.mailer, ctx.app.users.userService);

/**
 * The auth feature's application, composed once over this process.
 *
 * Both signed-out doors take it — the front door and `publicEnv` beside it —
 * which is why it is built in one place rather than composed twice. Every
 * capability it holds is the process's, and each takes the request rather than
 * being captured from one, so a single instance serves every caller.
 */
const authApp = AuthApp.create({
  clientIp: (ctx: TRPCContext) => getClientIp(ctx.req) ?? "unknown",
  rateLimit,
  route: (input) => signInRouter().route(input),
  addressIsRegistered: (ctx: TRPCContext, input) => signUp(ctx).addressIsRegistered(input),
  requestSignUpVerification: (ctx: TRPCContext, input) => signUp(ctx).requestVerification(input),
  completeSignUpVerification: (ctx: TRPCContext, input) => signUp(ctx).completeVerification(input),

  /**
   * A revoked invitation reads exactly like a missing one, the same way
   * `organization.acceptInvite` answers it: the journey ends quietly,
   * revealing nothing about the organization or the inviter. Expired is
   * different — it is recoverable (the inviter resends in one click), so it
   * gets its own named refusal.
   */
  readInviteLanding: async (ctx: TRPCContext, { inviteCode }) => {
    const invite = await ctx.prisma.organizationInvite.findUnique({
      where: { inviteCode },
      select: {
        status: true,
        expiration: true,
        organization: { select: { name: true } },
        requestedByUser: { select: { name: true } },
      },
    });

    if (!invite || invite.status === "REVOKED") {
      throw new InviteNotFoundError("Invitation not found");
    }

    const status = resolveInviteDisplayStatus(invite);
    if (status === "EXPIRED") {
      throw new InviteExpiredError();
    }

    return {
      organizationName: invite.organization.name,
      inviterName: invite.requestedByUser?.name ?? null,
      alreadyAccepted: status === "ACCEPTED",
    };
  },

  requestFreshInvite: async (ctx: TRPCContext, { inviteCode }) => {
    await invitesFor(ctx).requestFreshInvite({
      inviteCode,
      membersSettingsUrl: buildMembersSettingsUrl(),
    });
  },

  // ADR-027: the single source of truth for the sign-in mode. Never read
  // `env.NEXTAUTH_PROVIDER` directly here — a deployment whose licence gate
  // denies SSO must still be told to render the email form.
  resolveAuthProvider,
});

/** The join-request service, composed per request over this process's app. */
function joinRequestsFor(ctx: Pick<TRPCContext, "app">) {
  return joinRequestsService({
    authzGrants: ctx.app.authzGrants,
    featureFlags: ctx.app.featureFlags,
    mailer: ctx.app.mailer,
  });
}

/**
 * The caller's own verified address, and the reason every requester-side
 * join-request procedure starts here.
 *
 * `tryVerifiedEmailsOf` answers `null` for a user who is not on identifiers yet,
 * which is the legacy fallback the rest of the identity surface uses: the
 * `User.email` column, but only where better-auth has marked it verified. An
 * unverified address answers null, and every caller treats that as the
 * universal nothing.
 */
async function verifiedEmailFor(
  ctx: Pick<TRPCContext, "prisma">,
  { userId }: { userId: string },
): Promise<string | null> {
  const verified = await identityEmail().tryVerifiedEmailsOf({ userId });
  if (verified !== null) return verified[0]?.value ?? null;

  const row = await ctx.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return row?.emailVerified ? (row.email ?? null) : null;
}

/** The feature transports are typed against their own context; this is ours. */
const appContext = (ctx: unknown) => ctx as TRPCContext;

/**
 * Copies a workflow into another project, answering the code the experiment
 * surface has always answered when the source has no version to copy.
 *
 * The refusal is the feature's — a workflow with no committed version cannot
 * be replicated — and translating it into a transport code is the process's,
 * because the experiment transport maps workflow errors no further.
 */
async function copyStudioWorkflow(
  ctx: TRPCContext,
  input: Parameters<TRPCContext["app"]["workflows"]["copyStudioWorkflow"]>[0],
): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
  try {
    return await ctx.app.workflows.copyStudioWorkflow(input);
  } catch (error) {
    if (error instanceof WorkflowVersionRequiredError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Workflow version not found" });
    }
    throw error;
  }
}

/** Where one copy lives, for the "org / team / project" path shown beside it. */
const workflowCopyPathSelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      team: {
        select: {
          id: true,
          name: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} as const;

/** The copy-lineage selection `workflow.getAll` redacts against permissions. */
const workflowCopyLineageSelect = {
  id: true,
  projectId: true,
  name: true,
  icon: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  latestVersionId: true,
  currentVersionId: true,
  publishedId: true,
  publishedById: true,
  archivedAt: true,
  isEvaluator: true,
  isComponent: true,
  copiedFromWorkflowId: true,
  copiedFrom: {
    select: workflowCopyPathSelect,
  },
  copiedWorkflows: {
    where: { archivedAt: null },
    select: { projectId: true },
  },
} as const;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that chains the workbench rollout gate onto a builder whose input
 * generics belong to the feature package, so the gate below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * The workbench rollout gate, applied AFTER the policy so a caller is placed by
 * RBAC first and gated by the experiment second: a member who may not touch the
 * project must not learn from the answer whether the experiment is on for it.
 */
const requireWorkbenchEnabled = <TProcedure>(procedure: TProcedure): TProcedure =>
  (procedure as unknown as ChainableProcedure).use(
    enforceWorkbenchEnabled,
  ) as unknown as TProcedure;

/**
 * The one resolution both LangWatchQL doors run their statements as. It hashes
 * the project's LangWatchQL secret into the tenant capability the query runs
 * as, so it stays here and never leaves the calling procedure.
 */
const resolveRunCaller = (ctx: TRPCContext, input: { projectId: string }) =>
  resolveLangWatchQLCaller({ ctx, projectId: input.projectId });

/** The member's own content protections for one project. */
const resolveWorkbenchProtections = (ctx: TRPCContext, input: { projectId: string }) =>
  getUserProtectionsForProject(ctx, { projectId: input.projectId });

/** The same rollout decision, read rather than enforced. */
const isWorkbenchEnabled = (ctx: TRPCContext, input: { projectId: string }) =>
  lwqlEnabled({
    featureFlags: ctx.app.featureFlags,
    projectId: input.projectId,
    projects: ctx.app.projects.projectService,
  });

/**
 * Every packaged tRPC surface, installed in ONE call against this process's
 * mount. Adding a feature to `@langwatch/platform-api`'s list mounts it here;
 * there is no second enumeration to keep in step, which is what stops a
 * surface serving traffic while missing from the declaration sweep.
 */
const appTrpcFeatures = createAppTrpcFeatures({
  mount: { ...appTrpcMount, publicProcedure: appTrpcRoot.procedure },
  ports: {
    /**
     * One namespace, three transports. The reads, the LangWatchQL workbench and
     * the saved workbench charts all answer under `analytics.*`, and what each
     * needs from this process is the same kind of thing: the shared analytics
     * input schemas, this deployment's filter catalogue, the rollout gate, the
     * member's own content protections, and the project identity a restricted
     * statement executes as.
     */
    analytics: {
      reads: {
        // The two schemas are this process's because the same shapes are the
        // REST analytics body and the traces filter input: one definition, here,
        // is what keeps those surfaces from drifting.
        timeseriesInputSchema: timeseriesInput,
        sharedFiltersSchema: sharedFiltersInputSchema,
        filterFieldSchema: filterFieldsEnum,
        filterFieldRequiresKey: (field) => Boolean(availableFilters[field].requiresKey),
        filterFieldRequiresSubkey: (field) => Boolean(availableFilters[field].requiresSubkey),
      },

      workbench: {
        requireWorkbenchEnabled,
        isWorkbenchEnabled,
        maxStatementLength: MAX_LWQL_LENGTH,
        timeWindowSchema: lwqlTimeWindowSchema,
        granularityStepSchema: lwqlGranularityStepSchema,
        resolveProtections: resolveWorkbenchProtections,
        resolveRunCaller,
      },

      savedCharts: {
        requireWorkbenchEnabled,
        timeWindowSchema: lwqlTimeWindowSchema,
        granularityStepSchema: lwqlGranularityStepSchema,
        resolveProtections: resolveWorkbenchProtections,
        resolveRunCaller,
        // Admitted against the CALLER's own protections before it is stored,
        // which is the one place they are known: a member who cannot read costs
        // must not be able to save a chart that selects them.
        admitDefinition: (ctx: TRPCContext, input) =>
          validateSavedWorkbenchChartDefinition({
            projectId: input.projectId,
            protections: input.protections,
            definition: input.definition,
            lwql: ctx.app.langWatchQL,
          }),
        mapError: mapDashboardSavedWorkbenchChartError,
      },
    },

    annotation: {
      // Queue rows are still application-owned storage, and the request's own
      // client is what reaches them.
      queues: (ctx: TRPCContext) =>
        PostgresAnnotationQueueAdapter.create({ database: ctx.prisma }).build(),

      // A suggested output rewrites the trace itself, so it is carried over
      // only for a caller who may also update annotations. The declared check
      // on the procedure covers the annotation; this covers the correction.
      probeProjectPermission: (ctx: TRPCContext, projectId: string, permission: AuthzPermission) =>
        probeProjectPermission(ctx, projectId, permission),

      writeTraceSuggestion: (ctx: TRPCContext, { projectId, traceId, target, text, userId }) =>
        writeAnnotationSuggestionToOverlay({
          prisma: ctx.prisma,
          projectId,
          traceId,
          target,
          text,
          userId,
        }),

      loadTraces: (ctx: TRPCContext, input) => loadQueueItemTraces(ctx, input),

      // The trace-side write is an eventing command rather than an application
      // operation: carrying a comment onto the trace is ingestion into the
      // trace pipeline, not a rule the trace application owns.
      recordAnnotationOnTrace: (ctx: TRPCContext, input) =>
        ctx.app.commands.traces.addAnnotation(input),

      removeAnnotationFromTrace: (ctx: TRPCContext, input) =>
        ctx.app.commands.traces.removeAnnotation(input),

      queueTracesForAnnotation: (ctx: TRPCContext, input) =>
        createOrUpdateQueueItems({
          traceIds: [...input.traceIds],
          projectId: input.projectId,
          annotators: [...input.annotators],
          userId: input.userId,
          annotations: ctx.app.annotations.annotationService,
          // Which ids address a trace this project holds is trace storage's
          // answer, so it is resolved here rather than inside the queueing.
          findExistingTraceIds: (candidates) =>
            ClickHouseTraceService.create({
              prisma: ctx.prisma,
              traceCanonicalisation: ctx.app.traces.canonicalisation,
            }).findExistingTraceIds(candidates),
        }),

      toQueueSlug: toAnnotationQueueSlug,
    },

    /**
     * Fire and forget, exactly as the API-key router has always recorded it: a
     * credential response never waits on the audit write. The minted token is
     * never among the arguments the package passes here.
     */
    apiKeyAudit: (entry) => {
      void auditLog(entry);
    },

    /**
     * The support inbox, read straight out of the process's own store.
     *
     * A bug report is a global row — no organization, no team, no project — so
     * nothing here narrows by tenant and nothing could. The audit sink is the
     * same one every other back-office read is written to, and unlike the
     * API-key one above it is awaited: the row is the record of who opened
     * somebody's transcript, and it is written before they see it.
     */
    bugReports: {
      getAll: getAllBugReports,
      getById: getBugReportById,
      recordAudit: auditLog,
    },

    auth: authApp,

    /**
     * The privacy settings surface, whose three answers all need reach the
     * data-privacy package does not have.
     *
     * The snapshot walks the organization, department, team and group tables
     * and filters what it found by the caller's permission at each tier. Both
     * writes anchor the target scope to the project's organization first — so
     * a project id cannot be used to reach another tenant's rule — and then
     * authorize at the target's own tier, which is why a project member cannot
     * push a rule up to the organization.
     *
     * Parameters are annotated rather than inferred from the port: an
     * unannotated arrow is context-sensitive, so the snapshot and the written
     * rule would be resolved after the call's type arguments were fixed and
     * the client would be handed `{}` instead of either shape.
     */
    dataPrivacy: {
      getSnapshot: (
        ctx: TRPCContext,
        input: Readonly<{ projectId: string }>,
      ): Promise<DataPrivacySnapshot> =>
        getDataPrivacySnapshot(
          { prisma: ctx.prisma, session: ctx.session },
          { projectId: input.projectId },
        ),

      setForScope: async (
        ctx: TRPCContext,
        input: Readonly<{
          projectId: string;
          scope: DataPrivacyScope;
          personalOnly: boolean;
          config: DataPrivacyConfig;
        }>,
      ): Promise<DataPrivacyPolicyRow> => {
        const authCtx = { prisma: ctx.prisma, session: ctx.session };
        await assertScopeBelongsToProjectOrganization(authCtx, input.projectId, input.scope);
        await assertCanWriteDataPrivacyScope(authCtx, input.scope);
        try {
          return await getDataPrivacyPolicyService().setForScope({
            scope: input.scope,
            personalOnly: input.personalOnly,
            config: input.config,
          });
        } catch (error) {
          // The application's policy service is a second implementation over
          // the same table as the packaged one (see the feature's ADR-001), so
          // it raises its own copies of these two. Rethrown as the contract's,
          // because the surface that decides they mean `NOT_FOUND` and
          // `BAD_REQUEST` is the feature's transport and it recognises the
          // feature's classes.
          if (error instanceof AppScopeTargetNotFoundError) {
            throw new ScopeTargetNotFoundError(error.message);
          }
          if (error instanceof AppInvalidDataPrivacyConfigError) {
            throw new InvalidDataPrivacyConfigError(error.message);
          }
          throw error;
        }
      },

      removeForScope: async (
        ctx: TRPCContext,
        input: Readonly<{
          projectId: string;
          scope: DataPrivacyScope;
          personalOnly: boolean;
        }>,
      ): Promise<void> => {
        const authCtx = { prisma: ctx.prisma, session: ctx.session };
        await assertScopeBelongsToProjectOrganization(authCtx, input.projectId, input.scope);
        await assertCanWriteDataPrivacyScope(authCtx, input.scope);
        await getDataPrivacyPolicyService().removeForScope({
          scope: input.scope,
          personalOnly: input.personalOnly,
        });
      },
    },

    /**
     * What each rule write claims about the project id it accepts, written
     * where the enforcement is.
     *
     * Neither is a permission the runtime can resolve from the input: the id
     * that decides the answer is the TARGET scope's, and which tier that is
     * only becomes known once the scope has been anchored to this project's
     * organization. So the check is declared here as resolver-authorized and
     * the sentence names the two assertions the port above actually runs.
     */
    dataPrivacyScopeChecks: {
      write: authorizeInResolver({
        projectId:
          "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the write",
      }),
      removal: authorizeInResolver({
        projectId:
          "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the removal",
      }),
    },

    evaluations: {
      mappingsSchema: mappingStateSchema,

      /**
       * Azure Safety evaluators resolve their credentials solely from the
       * project's `azure_safety` Model Provider. There is no `process.env`
       * fallback, so an unconfigured provider deterministically resolves null
       * and the package reports every Azure variable as missing.
       *
       * Spec: specs/evaluators/azure-safety-byok-gating.feature.
       */
      tryResolveAzureSafetyEnv: (ctx: TRPCContext, { projectId }) =>
        getAzureSafetyEnvFromProject(ctx.app.modelProviders.providerService, projectId),

      evaluatorUnavailability,
      missingEnvironmentVariables: (envVars) => envVars.filter((envVar) => !process.env[envVar]),

      runEvaluationForTrace: async (ctx: TRPCContext, input) => {
        const protections = await getUserProtectionsForProject(ctx, {
          projectId: input.projectId,
        });

        return runEvaluationForTrace({
          projectId: input.projectId,
          traceId: input.traceId,
          evaluatorType: input.evaluatorType,
          settings: input.settings,
          mappings: input.mappings,
          protections,
          evaluations: ctx.app.evaluations,
          modelProviders: ctx.app.modelProviders.providerService,
          managedProviders: ctx.app.managedProviders,
          workflows: ctx.app.workflows.workflowService,
          evaluators: ctx.app.evaluators,
          traceCanonicalisation: ctx.app.traces.canonicalisation,
        });
      },

      trackEvaluationRan: ({ userId, projectId }) => {
        trackServerEvent({ userId, event: "evaluation_ran", projectId });
      },

      sendKeepAliveProbe: async (ctx: TRPCContext, { projectId }) => {
        await studioBackendPostEvent({
          projectId,
          nlpLambda: ctx.app.nlpLambda,
          modelProviders: ctx.app.modelProviders.providerService,
          message: { type: "is_alive", payload: {} },
          onEvent: () => {
            // Response received - lambda is warm
          },
        });
      },
    },

    experiments: {
      workbenchStateSchema,
      slugify,
      probeProjectPermission: (ctx, projectId, permission) =>
        probeProjectPermission(ctx as unknown as TRPCContext, projectId, permission),
      saveWorkflowVersion: (ctx, input) =>
        appContext(ctx).app.workflows.saveStudioVersion(input, ctx.actor()),
      copyWorkflowWithDatasets: (ctx, input) => copyStudioWorkflow(appContext(ctx), input),
      createWorkflow: async (ctx, input) =>
        await (ctx as unknown as TRPCContext).prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: input.projectId,
            name: input.name,
            icon: input.icon ?? null,
            description: input.description ?? null,
          },
        }),
      tryFindWorkflow: async (ctx, input) =>
        await (ctx as unknown as TRPCContext).prisma.workflow.findFirst({
          where: { id: input.workflowId, projectId: input.projectId },
        }),
      coerceMonitorMappings,
      upsertExperimentMonitor: async (ctx, { projectId, experimentId, monitor }) => {
        const monitorData = {
          name: monitor.name,
          checkType: monitor.checkType,
          slug: monitor.slug,
          preconditions: monitor.preconditions as object,
          parameters: monitor.parameters as Record<string, unknown>,
          mappings: monitor.mappings as object,
          sample: monitor.sample,
          enabled: monitor.enabled,
          executionMode: monitor.executionMode as "ON_MESSAGE",
        };

        return await (ctx as unknown as TRPCContext).prisma.monitor.upsert({
          where: { experimentId, projectId },
          update: monitorData,
          create: {
            ...monitorData,
            id: `monitor_${nanoid()}`,
            projectId,
            experimentId,
          },
        });
      },
      resolveAuthorNames: async (ctx, authorIds) =>
        await (ctx as unknown as TRPCContext).prisma.user.findMany({
          where: { id: { in: [...authorIds] } },
          select: { id: true, name: true },
        }),
    },

    graphs: {
      // The catalogue of filterable trace fields is the process's filter
      // registry, so a stored graph naming a field that has since been removed
      // is dropped on read rather than shipped to a page that cannot render it.
      filterFieldSchema: filterFieldsEnum,
      // The included trigger row carries provider secrets in actionParams (the
      // encrypted Slack bot token per ADR-041, webhook header values per
      // ADR-040 §3) — the same registry-driven redaction the automations
      // router applies on its own read paths.
      redactActionParams: (action: Trigger["action"], actionParams: Record<string, unknown>) =>
        redactActionParamsFor(action, actionParams) as Record<string, unknown>,
    },

    group: {
      // Groups arrive with SCIM, and the plan is read per organization out of
      // this process's billing store.
      assertScimAllowed: (ctx: TRPCContext, { organizationId }) =>
        assertEnterprisePlan({
          planProvider: ctx.app.planProvider,
          organizationId,
          user: ctx.session?.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
        }),
    },

    // Spec: specs/identity/identifier-model.feature.
    identity: {
      completeEmailVerification: (input) => verificationCeremony().completeEmailVerification(input),
    },

    integrationsChecks: {
      // Annotated rather than inferred from the port: an unannotated arrow is
      // context-sensitive, so the checklist's own shape would be resolved after
      // the call's type arguments were fixed and the client would be handed
      // `{}` instead of the rollup. Every other generic-carrying port here
      // states its parameters for the same reason.
      getCheckStatus: (
        _ctx: TRPCContext,
        input: Readonly<{ projectId: string }>,
      ): Promise<OnboardingCheckStatus> => onboardingChecks.getCheckStatus(input.projectId),
    },

    joinRequests: {
      lookup: (ctx: TRPCContext, input) => joinRequestsFor(ctx).lookup(input),
      pendingForUser: (ctx: TRPCContext, input) => joinRequestsFor(ctx).pendingForUser(input),
      request: (ctx: TRPCContext, input) => joinRequestsFor(ctx).request(input),
      withdraw: (ctx: TRPCContext, input) => joinRequestsFor(ctx).withdraw(input),
      pendingForOrganization: (ctx: TRPCContext, input) =>
        joinRequestsFor(ctx).pendingForOrganization(input),
      approve: (ctx: TRPCContext, input) => joinRequestsFor(ctx).approve(input),
      reject: (ctx: TRPCContext, input) => joinRequestsFor(ctx).reject(input),
      readJoining: (ctx: TRPCContext, input) => joinRequestsFor(ctx).readJoining(input),
      setJoining: (ctx: TRPCContext, input) => joinRequestsFor(ctx).setJoining(input),
      tryResolveVerifiedEmail: verifiedEmailFor,
      listUserNames: (ctx: TRPCContext, { userIds }) =>
        ctx.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        }),
    },

    /**
     * The four follow-ups the sign-up ceremony reaches for that are not the
     * organization's, plus the questionnaire schema its input is built from.
     *
     * The catalogue is an Enterprise governance capability; the personal
     * workspace is provisioned through the USER application, which names the
     * person the workspace belongs to rather than attributing it to whoever
     * asked; the first project goes through this process's own `project.create`
     * so it runs that surface's authorization, audit and Langy provisioning
     * instead of a second copy of them; and both sign-up notifications are
     * this deployment's marketing traffic.
     *
     * The questionnaire's own fields are read HERE for the same reason the
     * schema is supplied here: `utmCampaign` is a field of this process's
     * sign-up form, so the transport forwards the answers opaquely and the
     * process reads what it put in them.
     */
    onboarding: {
      signUpDataSchema,
      ensureDefaultAiToolCatalog: (ctx: TRPCContext, input) =>
        ctx.app.governance.aiToolEnsureDefaultCatalog(input),
      ensurePersonalWorkspace: (ctx: TRPCContext, input) =>
        ctx.app.users.ensurePersonalWorkspace(input),
      createProject: (ctx: TRPCContext, input) => projectRouter.createCaller(ctx).create(input),
      sendSlackSignupEvent: (ctx: TRPCContext, input) =>
        ctx.app.notifications.sendSlackSignupEvent({
          ...input,
          signUpData: asSignUpData(input.signUpData),
          utmCampaign: asSignUpData(input.signUpData)?.utmCampaign,
        }),
      sendHubspotSignupForm: (ctx: TRPCContext, input) =>
        ctx.app.notifications.sendHubspotSignupForm({
          ...input,
          signUpData: asSignUpData(input.signUpData),
        }),
      // Named field by field rather than spread: the nurturing call REQUIRES
      // the two identity keys, present-and-undefined included, and a spread of
      // optional ones would let a rename drop them silently.
      fireSignupNurturing: (input) =>
        fireSignupNurturingCalls({
          userId: input.userId,
          email: input.email,
          name: input.name,
          organizationId: input.organizationId,
          organizationName: input.organizationName,
          signUpData: asSignUpData(input.signUpData),
          primaryIntent: input.primaryIntent,
        }),
      recordIntegrationMethod: ({ userId, selection }) =>
        fireIntegrationMethodNurturing({
          userId,
          integrationMethod: mapProductSelectionToIntegrationMethod(selection),
        }),
      reportError: (error, context) => captureException(toError(error), context),
    },

    prisma,

    /**
     * Everything behind `user.*` that belongs to this deployment rather than
     * to the person: which provider signs them in, whether passkeys exist
     * here, how a password is hashed and where the Auth0 tenant is, the
     * account and organization rows the /me screens read, the signup throttle,
     * product analytics, and the mail a budget-increase request sends.
     *
     * Spec: packages/features/user/specs/user.feature,
     *       specs/settings/user-avatar.feature.
     */
    user: {
      resolveAuthProvider,
      deploymentOffersPasskeys,
      appBaseUrl: () => env.NEXTAUTH_URL ?? env.BASE_HOST ?? null,
      clientIp: (ctx: TRPCContext) => getClientIp(ctx.req) ?? "unknown",
      rateLimit,
      trackServerEvent,

      hashPassword: ({ password }) => hash(password, 10),
      passwordMatches: ({ password, hash: stored }) => compare(password, stored),
      tryFindCredentialAccount: (ctx: TRPCContext, { userId }) =>
        ctx.prisma.account.findFirst({
          where: { userId, provider: "credential" },
          select: { id: true, password: true },
        }),
      writeCredentialPassword: async (ctx: TRPCContext, { accountId, passwordHash }) => {
        await ctx.prisma.account.update({
          where: { id: accountId },
          data: { password: passwordHash },
        });
      },
      tryFindAuth0DatabaseAccount: (ctx: TRPCContext, { userId }) =>
        ctx.prisma.account.findFirst({
          where: {
            userId,
            provider: "auth0",
            providerAccountId: { startsWith: "auth0|" },
          },
          select: { providerAccountId: true },
        }),
      changeAuth0Password: async (input) => {
        try {
          const result = await changeAuth0Password(input);
          return result.ok ? { outcome: "changed" } : { outcome: "wrong_password" };
        } catch (error) {
          if (error instanceof Auth0ApiError) return auth0Outcome(error);
          throw error;
        }
      },

      emailIsTaken: async (ctx: TRPCContext, { email }) =>
        (await ctx.prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })) !== null,
      listLinkedAccounts: (ctx: TRPCContext, { userId }) =>
        ctx.prisma.account.findMany({
          where: { userId },
          select: { id: true, provider: true, providerAccountId: true },
        }),
      // Serializable isolation prevents the read of the account count from being
      // a stale snapshot if a concurrent unlink commits between this
      // transaction's count and its delete.
      unlinkAccount: (ctx: TRPCContext, { userId, accountId }) =>
        ctx.prisma.$transaction(
          async (tx) => {
            const accountCount = await tx.account.count({ where: { userId } });
            if (accountCount <= 1) return "last_account" as const;
            const account = await tx.account.findFirst({
              where: { id: accountId, userId },
            });
            if (!account) return "not_found" as const;
            await tx.account.delete({ where: { id: accountId } });
            return "unlinked" as const;
          },
          { isolationLevel: "Serializable" },
        ),
      revokeCliTokensForUser: async (ctx: TRPCContext, input) => {
        await ctx.app.governance.cliTokenRevokeForUser(input);
      },

      isOrganizationMember: async (ctx: TRPCContext, { userId, organizationId }) =>
        (await ctx.prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId, organizationId } },
        })) !== null,
      tryResolveSupportContact: (ctx: TRPCContext, { organizationId }) =>
        resolveSupportContact({ prisma: ctx.prisma, organizationId }),
      resolveBudgetIncreaseRecipient: async (ctx: TRPCContext, { organizationId }) => {
        const adminEmail = await resolveOrgAdminEmail({ prisma: ctx.prisma, organizationId });
        if (!adminEmail) {
          userLogger.warn(
            { organizationId },
            "budget increase requested but the organization has no admin",
          );
          throw new NoAdminConfiguredError();
        }
        return adminEmail;
      },
      sendBudgetIncreaseRequest: (ctx: TRPCContext, input) =>
        sendBudgetIncreaseRequestEmail({ mailer: ctx.app.mailer, ...input }),
      tryGetOrganizationName: async (ctx: TRPCContext, { organizationId }) =>
        (
          await ctx.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true },
          })
        )?.name ?? null,
      tryGetUserContact: (ctx: TRPCContext, { userId }) =>
        ctx.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        }),
      tryFindFirstProjectSlug: async (ctx: TRPCContext, { organizationId, userId }) =>
        (
          await ctx.prisma.project.findFirst({
            where: {
              team: { organizationId, members: { some: { userId } } },
              archivedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          })
        )?.slug ?? null,

      tryResolveDefaultRoutingPolicy: (ctx: TRPCContext, input) =>
        ctx.app.governance.tryResolveDefaultRoutingPolicyForUser(input),
      listPersonalVirtualKeys: (ctx: TRPCContext, input) =>
        ctx.app.governance.personalVirtualKeyList(input),
      checkBudget: (ctx: TRPCContext, input) => ctx.app.gatewayStores.budgetDecisions.check(input),
    },

    workflows: {
      lifecycle: {
        hasProjectPermission: (ctx, input) =>
          probeProjectPermission(appContext(ctx), input.projectId, input.permission),

        // Each related project needs its own RBAC check; cap concurrency so a
        // workflow with many copies can't exhaust the DB connection pool.
        hasProjectPermissions: async (ctx, input) => {
          const permitted = new Map<string, boolean>();
          await pMapLimited({
            items: [...input.projectIds],
            concurrency: 5,
            fn: async (projectId) => {
              permitted.set(
                projectId,
                await probeProjectPermission(appContext(ctx), projectId, input.permission),
              );
            },
          });
          return permitted;
        },

        prepareDsl: (ctx, input) => appContext(ctx).app.workflows.prepareStudioDsl(input),

        saveWorkflowVersion: (ctx, input) =>
          appContext(ctx).app.workflows.saveStudioVersion(input, ctx.actor()),

        listWorkflowsWithCopyLineage: async (ctx, input) =>
          await appContext(ctx).prisma.workflow.findMany({
            where: { projectId: input.projectId, archivedAt: null },
            orderBy: { updatedAt: "desc" },
            select: workflowCopyLineageSelect,
          }),

        tryFindWorkflow: async (ctx, input) =>
          // Prisma requires projectId in the where clause for a project-level model.
          await appContext(ctx).prisma.workflow.findFirst({
            where: {
              id: input.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
          }),

        // Copies are queried through the relation so the findMany's projectId
        // requirement does not force a single project on a cross-project read.
        tryFindCopiesWithPath: async (ctx, input) => {
          const workflowWithCopies = await appContext(ctx).prisma.workflow.findUnique({
            where: {
              id: input.workflowId,
              projectId: input.projectId,
            },
            select: {
              id: true,
              copiedWorkflows: {
                where: {
                  archivedAt: null,
                },
                select: workflowCopyPathSelect,
              },
            },
          });

          return workflowWithCopies ? workflowWithCopies.copiedWorkflows : null;
        },

        tryFindWorkflowWithSource: async (ctx, input) =>
          await appContext(ctx).prisma.workflow.findUnique({
            where: {
              id: input.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
            include: {
              latestVersion: true,
              copiedFrom: {
                include: {
                  latestVersion: true,
                },
              },
            },
          }),

        tryFindWorkflowWithCopies: async (ctx, input) =>
          await appContext(ctx).prisma.workflow.findUnique({
            where: {
              id: input.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
            include: {
              latestVersion: true,
              copiedWorkflows: {
                where: {
                  archivedAt: null,
                },
                include: {
                  latestVersion: true,
                },
              },
            },
          }),

        tryFindLatestVersionNumber: async (ctx, input) => {
          const workflow = await appContext(ctx).prisma.workflow.findUnique({
            where: {
              id: input.workflowId,
              projectId: input.projectId,
            },
            include: {
              latestVersion: true,
            },
          });

          return workflow ? { version: workflow.latestVersion?.version ?? null } : null;
        },

        listAgentsForWorkflow: async (ctx, input) =>
          await appContext(ctx).prisma.agent.findMany({
            where: {
              workflowId: input.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
            select: { id: true, name: true },
          }),

        listMonitorsForEvaluators: async (ctx, input) =>
          await appContext(ctx).prisma.monitor.findMany({
            where: {
              evaluatorId: { in: [...input.evaluatorIds] },
              projectId: input.projectId,
            },
            select: { id: true, name: true, evaluatorId: true },
          }),

        cascadeArchiveWorkflow: async (ctx, input) => {
          const now = input.unarchive ? null : new Date();

          return appContext(ctx).prisma.$transaction(async (tx) => {
            // 1. Find all evaluators linked to this workflow
            const evaluators = await tx.evaluator.findMany({
              where: {
                workflowId: input.workflowId,
                projectId: input.projectId,
                archivedAt: null,
              },
              select: { id: true },
            });
            const evaluatorIds = evaluators.map((e) => e.id);

            // 2. Delete monitors linked to those evaluators (hard delete)
            const deletedMonitors =
              evaluatorIds.length > 0
                ? await tx.monitor.deleteMany({
                    where: {
                      evaluatorId: { in: evaluatorIds },
                      projectId: input.projectId,
                    },
                  })
                : { count: 0 };

            // 3. Archive evaluators linked to this workflow
            const archivedEvaluators = await tx.evaluator.updateMany({
              where: {
                workflowId: input.workflowId,
                projectId: input.projectId,
              },
              data: { archivedAt: now },
            });

            // 4. Archive agents linked to this workflow
            const archivedAgents = await tx.agent.updateMany({
              where: {
                workflowId: input.workflowId,
                projectId: input.projectId,
              },
              data: { archivedAt: now },
            });

            // 5. Archive the workflow itself
            const workflow = await tx.workflow.update({
              where: { id: input.workflowId, projectId: input.projectId },
              data: { archivedAt: now },
            });

            return {
              workflow,
              archivedEvaluatorsCount: archivedEvaluators.count,
              archivedAgentsCount: archivedAgents.count,
              deletedMonitorsCount: deletedMonitors.count,
            };
          });
        },

        generateCommitMessage: async (ctx, input) => {
          const diff = createPatch(
            "workflow.json",
            input.previousDsl,
            input.nextDsl,
            "Previous Version",
            "New Version",
          );

          // ModelNotConfiguredError passes through untouched (its own
          // toast surface); every other provider/SDK failure surfaces as
          // AiCallFailedError so the frontend can render the "double-check
          // your model configuration" hint toast instead of a raw 500.
          const commitFeature = featureByKey("workflows.commit_message");
          if (!commitFeature) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "workflows.commit_message feature is not registered",
            });
          }
          const commitMessage = await wrapAiCall(commitFeature, async () =>
            generateText({
              model: await getVercelAIModel({
                projectId: input.projectId,
                featureKey: "workflows.commit_message",
                modelProviders: appContext(ctx).app.modelProviders.providerService,
                managedProviders: appContext(ctx).app.managedProviders,
              }),
              providerOptions: {
                openai: {
                  reasoningEffort: "low",
                } satisfies OpenAIResponsesProviderOptions,
              },
              messages: [
                {
                  role: "system",
                  content: `
You are a diff generator for the LLM Workflow builder from LangWatch Optimization Studio.
Generate very short, concise commit messages for the changes in the diff. From 1 to 5 words max, all lowercase.
If changing the model, just say the short new model name, like "gpt-4o", nothing else.
For other changes:
- Ignore renames and position changes unless it's the only thing that changed.
- Explain not only the keys that changed, but the content inside them, for example do not say just "updated prompt", \
but the actual change that was made inside the fields with as few words as possible, like "avoid word <example>".
- By the way, always refer to the prompt as "prompt", not "instructions".
- When changing the evaluator, it's not just the name the changes, it means the workflow is actually now using a different evaluator.
- Do not use the word "edge", the user doesn't know the internal structure of the DSL, understand what is going on instead.
            `,
                },
                {
                  role: "user",
                  content: `
Original File:
\`\`\`json
${input.previousDsl}
\`\`\`

Diff:
\`\`\`diff
${diff}
\`\`\`
            `,
                },
              ],
            }),
          );

          // A commit message is one short string: a plain-text completion, not a
          // function-tool round-trip. Function tools combined with reasoning_effort
          // are rejected on /v1/chat/completions for the gpt-5 family (the provider
          // asks for /v1/responses), and these model calls go through the
          // OpenAI-compatible chat-completions proxy. Generating text directly
          // sidesteps that incompatibility and behaves the same across providers.

          // TODO: save call costs to user account

          return commitMessage.text.trim();
        },

        workflowCreated: (_ctx, input) => fireWorkflowCreatedNurturing(input),
        captureException: (error) => captureException(toError(error)),
      },

      // Written out rather than inferred: the studio reads a stored version and
      // a published component with the shape the rows have, and the transport
      // is generic over both so the client sees exactly that. A context-
      // sensitive implementation here would leave those two type parameters
      // with nothing to infer from, and the studio's pages would be handed
      // `unknown` instead of a workflow.
      optimization: {
        // The studio's chat panel runs the workflow over the same public run
        // endpoint an external caller uses, authenticated as the project.
        runPublishedWorkflow: async (
          ctx: TRPCContext,
          input: { workflowId: string; projectId: string; body: unknown },
        ) => {
          const project = await ctx.prisma.project.findFirst({
            where: { id: input.projectId },
          });

          const apiKey = project?.apiKey;

          const response = await fetch(
            `${process.env.BASE_HOST}/api/workflows/${input.workflowId}/run`,
            {
              method: "POST",
              body: JSON.stringify(input.body),
              headers: {
                "Content-Type": "application/json",
                ...(apiKey && { "x-auth-token": apiKey }),
              },
            },
          );

          return await response.json();
        },
        tryGetWorkflow: async (
          ctx: TRPCContext,
          input: { workflowId: string; projectId: string },
        ) =>
          await ctx.prisma.workflow.findFirst({
            where: { id: input.workflowId, projectId: input.projectId },
          }),
        tryGetWorkflowVersion: async (
          ctx: TRPCContext,
          input: { versionId: string; projectId: string },
        ) =>
          await ctx.prisma.workflowVersion.findFirst({
            where: { id: input.versionId, projectId: input.projectId },
          }),
        setWorkflowFlags: async (
          ctx: TRPCContext,
          input: {
            workflowId: string;
            projectId: string;
            isComponent?: boolean;
            isEvaluator?: boolean;
          },
        ) => {
          await ctx.prisma.workflow.update({
            where: { id: input.workflowId, projectId: input.projectId },
            data: {
              ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
              ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
            },
          });
        },
        listPublishedComponents: async (ctx: TRPCContext, input: { projectId: string }) => {
          const workflows = await ctx.prisma.workflow.findMany({
            where: {
              projectId: input.projectId,
              OR: [{ isComponent: true }, { isEvaluator: true }],
            },
            include: { versions: true },
          });

          // Each component carries only the version it publishes; the studio picks
          // a component by its published shape, never by a draft.
          workflows.forEach((workflow) => {
            workflow.versions = workflow.versions.filter(
              (version) => version.id === workflow.publishedId,
            );
          });

          return workflows;
        },
      },
    },
  },
});

const coreRouters = {
  // Every packaged surface, mounted by iteration rather than one line each.
  ...appTrpcFeatures,
  agents: agentsRouter,
  evaluators: evaluatorsRouter,
  httpProxy: httpProxyRouter,
  organization: organizationRouter,
  project: projectRouter,
  team: teamRouter,
  traces: tracesRouter,
  tracesV2: tracesV2Router,
  traceEditOverlay: traceEditOverlayRouter,
  codingAgents: codingAgentsRouter,
  spans: spansRouter,
  monitors: monitorsRouter,
  costs: costsRouter,
  plan: planRouter,
  presence: presenceRouter,
  topics: topicsRouter,
  dataset: datasetRouter,
  datasetRecord: datasetRecordRouter,
  home: homeRouter,
  export: exportRouter,
  batchRecord: batchRecordRouter,
  limits: limitsRouter,
  automation: automationRouter,
  authz: authzRouter,
  featureFlag: featureFlagRouter,
  modelProvider: modelProviderRouter,
  llmModelCost: llmModelCostsRouter,
  // Two owners, one wire name. The packaged account surface comes from the
  // one list; `user.personalUsage`, `user.budgetOverview` and
  // `user.cliBootstrap` read governance data and are owned by that feature,
  // the same way `governance` below merges its two.
  user: appTrpcRoot.mergeRouters(
    appTrpcFeatures.user,
    enterpriseGovernanceRouters.personalDashboard,
  ),
  ssoConnections: enterpriseRouters.ssoConnections,
  setupSkills: setupSkillsRouter,
  share: shareRouter,
  sharedTrace: sharedTraceRouter,
  pinnedTrace: pinnedTraceRouter,
  dataRetention: dataRetentionRouter,
  emailSuppression: emailSuppressionRouter,
  translate: translateRouter,
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
  ops: opsRouter,
  storedObjects: storedObjectsRouter,
  virtualKeys: gatewayRouters.virtualKeys,
  personalVirtualKeys: enterpriseGatewayRouters.personalVirtualKeys,
  personalWorkspaceFeatures: personalWorkspaceFeaturesRouter,
  routingPolicy: enterpriseGatewayRouters.routingPolicy,
  ingestionSources: enterpriseGovernanceRouters.ingestionSources,
  activityMonitor: enterpriseGovernanceRouters.activityMonitor,
  anomalyRules: enterpriseGovernanceRouters.anomalyRules,
  aiTools: enterpriseGovernanceRouters.aiTools,
  departments: enterpriseGovernanceRouters.departments,
  ingestionTemplates: enterpriseGovernanceRouters.ingestionTemplates,
  ingestionKey: enterpriseGovernanceRouters.ingestionKey,
  governance: appTrpcRoot.mergeRouters(governanceRouter, enterpriseGovernanceRouters.governance),
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
  currency: enterpriseRouters.currency,
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
