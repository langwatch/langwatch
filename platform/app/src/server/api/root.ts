import { governanceRouter } from "./routers/governance/governance";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  createAuthzTrpcRouter,
  createAutomationTrpcRouter,
  createCodingAgentTrpcRouter,
  createEmailSuppressionTrpcRouter,
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
import { getAllForProjectInput, tracesFilterInput } from "./ports/traces.schemas";
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
  AppSavedWorkbenchChartPolicy,
  mapDashboardSavedWorkbenchChartError,
} from "~/runtime/app/features/dashboard-saved-workbench-chart-policy.adapter";
import { availableFilters } from "~/server/filters/registry";
import { resolveLangWatchQLCaller } from "./ports/lwqlCaller";
import { enforceWorkbenchEnabled } from "./ports/workbenchAccessMiddleware";
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
  getDataPrivacyPolicyService,
  InvalidDataPrivacyConfigError as AppInvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError as AppScopeTargetNotFoundError,
} from "~/server/data-privacy/dataPrivacyPolicy.service";
import { RecentItemsService } from "~/server/home/recent-items.service";
import { UsageStatsService } from "~/server/license-enforcement/usage-stats.service";
import { sendBudgetIncreaseRequestEmail } from "~/server/mailer/budgetIncreaseRequestEmail";
import { wrapAiCall } from "~/server/modelProviders/aiCallFailedError";
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

const coreRouters = {
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
  topics: topicsRouter,
  dataset: datasetRouter,
  datasetRecord: datasetRecordRouter,
  home: homeRouter,
  batchRecord: batchRecordRouter,
  limits: limitsRouter,
  automation: automationRouter,
  authz: authzRouter,
  featureFlag: featureFlagRouter,
  modelProvider: modelProviderRouter,
  llmModelCost: llmModelCostsRouter,
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
