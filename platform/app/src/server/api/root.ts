import { activityMonitorRouter } from "./routers/governance/activityMonitor";
import { aiToolsRouter } from "./routers/governance/aiTools";
import { anomalyRulesRouter } from "./routers/governance/anomalyRules";
import { departmentsRouter } from "./routers/governance/departments";
import { governanceRouter } from "./routers/governance/governance";
import { ingestionKeyRouter } from "./routers/governance/ingestionKey";
import { ingestionSourcesRouter } from "./routers/governance/ingestionSources";
import { ingestionTemplatesRouter } from "./routers/governance/ingestionTemplates";
import { personalSessionsRouter } from "./routers/governance/personalSessions";
import { sessionPolicyRouter } from "./routers/governance/sessionPolicy";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  appTrpcNoPermissionPolicy,
  appTrpcPolicy,
  createOpsTrpcRouter,
  createPinnedTraceTrpcRouter,
  createPromptTagTrpcRouter,
  createPromptTrpcRouter,
  createScenarioTrpcRouter,
  createShareTrpcRouter,
  createStoredObjectTrpcRouter,
  createSuiteTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyKit,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
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
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
} from "@langwatch/enterprise-api";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { auditLog } from "~/runtime/app/features/audit-log";
import { authProviderIsMounted, platformSSOAllowed } from "~/runtime/app/features/sso";
import { getLicenseCryptography, getLicenseHandler } from "~/runtime/app/licensing";
import { ssoConnections } from "~/server/app-layer/identity/runtime";
import { SsoConnectionBackofficeService } from "~/server/app-layer/identity/sso-connection-backoffice.service";
import { systemMigrationsService } from "~/server/app-layer/system-migrations/runtime";
import { resolveHotDays, TABLE_TTL_CONFIG } from "~/server/clickhouse/ttlReconciler";
import {
  getEventSubscriberMetadata,
  getProjectionMetadata,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { grafanaConfigFromEnv } from "~/utils/grafanaLinks";
import { assertEnterprisePlanType, ENTERPRISE_FEATURE_ERRORS } from "./enterprise";
import { checkOpsPermission } from "./rbac";
import { agentsRouter } from "~/runtime/app/internal-api/agents.router";
import { analyticsRouter } from "./routers/analytics";
import { annotationRouter } from "./routers/annotation";
import { annotationScoreRouter } from "./routers/annotationScore";
import { apiKeyRouter } from "./routers/apiKey";
import { authzRouter } from "./routers/authz";
import { automationRouter } from "./routers/automations";
import { batchRecordRouter } from "~/runtime/app/internal-api/batch-record.router";
import { bugReportsRouter } from "./routers/bugReports";
import { codingAgentsRouter } from "./routers/coding-agent";
import { costsRouter } from "./routers/costs";
import { currencyRouter } from "./routers/currency";
import { dashboardsRouter } from "./routers/dashboards";
import { dataPrivacyRouter } from "./routers/dataPrivacy";
import { dataRetentionRouter } from "~/runtime/app/internal-api/data-retention.router";
import { datasetRouter } from "~/runtime/app/internal-api/dataset.router";
import { datasetRecordRouter } from "~/runtime/app/internal-api/dataset-record.router";
import { emailSuppressionRouter } from "./routers/emailSuppression";
import { evaluationsRouter } from "./routers/evaluations";
import { evaluatorsRouter } from "~/runtime/app/internal-api/evaluator.router";
import { experimentsRouter } from "./routers/experiments";
import { exportRouter } from "./routers/export";
import { featureFlagRouter } from "~/runtime/app/internal-api/feature-flag.router";
import { frontDoorRouter } from "./routers/frontDoor";
import { gatewayBudgetsRouter } from "./routers/gatewayBudgets";
import { gatewayCacheRulesRouter } from "./routers/gatewayCacheRules";
import { gatewayGuardrailsRouter } from "./routers/gatewayGuardrails";
import { gatewaySpendEventsRouter } from "./routers/gatewaySpendEvents";
import { gatewayUsageRouter } from "./routers/gatewayUsage";
import { githubRouter } from "~/runtime/app/internal-api/github.router";
import { graphsRouter } from "./routers/graphs";
import { groupRouter } from "./routers/group";
import { homeRouter } from "./routers/home";
import { httpProxyRouter } from "./routers/httpProxy";
import { identityRouter } from "./routers/identity";
import { integrationsChecksRouter } from "./routers/integrationsChecks";
import { joinRequestsRouter } from "./routers/joinRequests";
import { langyRouter } from "~/runtime/app/internal-api/langy.router";
import { langyEgressRouter } from "~/runtime/app/internal-api/langy.router";
import { limitsRouter } from "./routers/limits";
import { llmModelCostsRouter } from "~/runtime/app/internal-api/model-provider.router";
import { modelProviderRouter } from "~/runtime/app/internal-api/model-provider.router";
import { monitorsRouter } from "~/runtime/app/internal-api/monitor.router";
import { onboardingRouter } from "./routers/onboarding/onboarding.router";
import { optimizationRouter } from "./routers/optimization";
import { organizationRouter } from "./routers/organization";
import { personalVirtualKeysRouter } from "./routers/personalVirtualKeys";
import { personalWorkspaceFeaturesRouter } from "./routers/personalWorkspaceFeatures";
import { planRouter } from "./routers/plan";
import { presenceRouter } from "~/runtime/app/internal-api/presence.router";
import { projectRouter } from "~/runtime/app/internal-api/project.router";
import { publicEnvRouter } from "./routers/publicEnv";
import { roleBindingRouter } from "~/runtime/app/internal-api/role-binding.router";
import { roleRouter } from "~/runtime/app/internal-api/role.router";
import { routingPoliciesRouter } from "./routers/routingPolicies";
import { savedViewsRouter } from "./routers/savedViews";
import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";
import { setupSkillsRouter } from "./routers/setupSkills";
import { sharedTraceRouter } from "./routers/sharedTrace";
import { spansRouter } from "./routers/spans";
import { teamRouter } from "~/runtime/app/internal-api/team.router";
import { topicsRouter } from "~/runtime/app/internal-api/topic.router";
import { traceEditOverlayRouter } from "./routers/traceEditOverlay";
import { tracesRouter } from "./routers/traces";
import { tracesV2Router } from "./routers/tracesV2";
import { translateRouter } from "./routers/translate";
import { userRouter } from "./routers/user";
import { virtualKeysRouter } from "./routers/virtualKeys";
import { webhookEndpointsRouter } from "./routers/webhookEndpoints";
import { workflowRouter } from "./routers/workflows";

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

const licenseLogger = createLogger("langwatch:api:licenseRouter");
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
    license: {
      licenses: getLicenseHandler,
      cryptography: getLicenseCryptography,
      configuredAuthProvider: () => env.NEXTAUTH_PROVIDER,
      platformSsoAllowed: platformSSOAllowed,
      authProviderIsMounted,
      reportSigningFailure: ({ organizationId, error }) =>
        licenseLogger.error({ organizationId, error }, "[license] Failed to sign license"),
    },
    licenseEnforcement: {
      checkLimit: ({ organizationId, limitType, user }) =>
        createLicenseEnforcementService(prisma).checkLimit(organizationId, limitType, user),
      reportError: captureException,
    },
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
  virtualKeys: virtualKeysRouter,
  personalVirtualKeys: personalVirtualKeysRouter,
  personalWorkspaceFeatures: personalWorkspaceFeaturesRouter,
  routingPolicy: routingPoliciesRouter,
  ingestionSources: ingestionSourcesRouter,
  activityMonitor: activityMonitorRouter,
  anomalyRules: anomalyRulesRouter,
  aiTools: aiToolsRouter,
  departments: departmentsRouter,
  ingestionTemplates: ingestionTemplatesRouter,
  ingestionKey: ingestionKeyRouter,
  governance: governanceRouter,
  personalSessions: personalSessionsRouter,
  sessionPolicy: sessionPolicyRouter,
  gatewayBudgets: gatewayBudgetsRouter,
  gatewayCacheRules: gatewayCacheRulesRouter,
  gatewayGuardrails: gatewayGuardrailsRouter,
  gatewayUsage: gatewayUsageRouter,
  gatewaySpendEvents: gatewaySpendEventsRouter,
  webhookEndpoints: webhookEndpointsRouter,
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
