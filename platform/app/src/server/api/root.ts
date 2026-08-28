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
import { licenseRouter } from "./routers/license";
import { licenseEnforcementRouter } from "./routers/licenseEnforcement";
import { limitsRouter } from "./routers/limits";
import { llmModelCostsRouter } from "~/runtime/app/internal-api/model-provider.router";
import { modelProviderRouter } from "~/runtime/app/internal-api/model-provider.router";
import { monitorsRouter } from "~/runtime/app/internal-api/monitor.router";
import { onboardingRouter } from "./routers/onboarding/onboarding.router";
import { opsRouter } from "./routers/ops";
import { optimizationRouter } from "./routers/optimization";
import { organizationRouter } from "./routers/organization";
import { personalVirtualKeysRouter } from "./routers/personalVirtualKeys";
import { personalWorkspaceFeaturesRouter } from "./routers/personalWorkspaceFeatures";
import { pinnedTraceRouter } from "./routers/pinnedTrace";
import { planRouter } from "./routers/plan";
import { presenceRouter } from "~/runtime/app/internal-api/presence.router";
import { projectRouter } from "~/runtime/app/internal-api/project.router";
import { promptTagsRouter } from "./routers/prompt-tags.trpc-router";
import { promptsRouter } from "./routers/prompts";
import { publicEnvRouter } from "./routers/publicEnv";
import { roleBindingRouter } from "~/runtime/app/internal-api/role-binding.router";
import { roleRouter } from "~/runtime/app/internal-api/role.router";
import { routingPoliciesRouter } from "./routers/routingPolicies";
import { savedViewsRouter } from "./routers/savedViews";
import { scenarioRouter } from "./routers/scenarios";
import { scimTokenRouter } from "./routers/scimToken";
import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";
import { setupSkillsRouter } from "./routers/setupSkills";
import { shareRouter } from "./routers/share";
import { sharedTraceRouter } from "./routers/sharedTrace";
import { spansRouter } from "./routers/spans";
import { ssoConnectionsRouter } from "./routers/ssoConnections";
import { storedObjectsRouter } from "./routers/stored-objects.router";
import { subscriptionRouter } from "./routers/subscription";
import { suiteRouter } from "./routers/suites";
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
  ssoConnections: ssoConnectionsRouter,
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
  license: licenseRouter,
  licenseEnforcement: licenseEnforcementRouter,
  scimToken: scimTokenRouter,
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
  subscription: subscriptionRouter,
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
