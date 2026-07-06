import { activityMonitorRouter } from "@ee/governance/routers/activityMonitor";
import { aiToolsRouter } from "@ee/governance/routers/aiTools";
import { anomalyRulesRouter } from "@ee/governance/routers/anomalyRules";
import { departmentsRouter } from "@ee/governance/routers/departments";
import { governanceRouter } from "@ee/governance/routers/governance";
import { ingestionKeyRouter } from "@ee/governance/routers/ingestionKey";
import { ingestionSourcesRouter } from "@ee/governance/routers/ingestionSources";
import { ingestionTemplatesRouter } from "@ee/governance/routers/ingestionTemplates";
import { personalSessionsRouter } from "@ee/governance/routers/personalSessions";
import { sessionPolicyRouter } from "@ee/governance/routers/sessionPolicy";
import { createTRPCRouter } from "~/server/api/trpc";
import { agentsRouter } from "./routers/agents";
import { analyticsRouter } from "./routers/analytics";
import { annotationRouter } from "./routers/annotation";
import { annotationScoreRouter } from "./routers/annotationScore";
import { apiKeyRouter } from "./routers/apiKey";
import { automationRouter } from "./routers/automations";
import { batchRecordRouter } from "./routers/batchRecord";
import { costsRouter } from "./routers/costs";
import { currencyRouter } from "./routers/currency";
import { dashboardsRouter } from "./routers/dashboards";
import { dataPrivacyRouter } from "./routers/dataPrivacy";
import { dataRetentionRouter } from "./routers/dataRetention";
import { datasetRouter } from "./routers/dataset";
import { datasetRecordRouter } from "./routers/datasetRecord";
import { emailSuppressionRouter } from "./routers/emailSuppression";
import { evaluationsRouter } from "./routers/evaluations";
import { evaluatorsRouter } from "./routers/evaluators";
import { experimentsRouter } from "./routers/experiments";
import { exportRouter } from "./routers/export";
import { featureFlagRouter } from "./routers/featureFlag";
import { gatewayBudgetsRouter } from "./routers/gatewayBudgets";
import { gatewayCacheRulesRouter } from "./routers/gatewayCacheRules";
import { gatewayGuardrailsRouter } from "./routers/gatewayGuardrails";
import { gatewayUsageRouter } from "./routers/gatewayUsage";
import { graphsRouter } from "./routers/graphs";
import { groupRouter } from "./routers/group";
import { homeRouter } from "./routers/home";
import { httpProxyRouter } from "./routers/httpProxy";
import { integrationsChecksRouter } from "./routers/integrationsChecks";
import { langyGithubRouter } from "./routers/langyGithub";
import { licenseRouter } from "./routers/license";
import { licenseEnforcementRouter } from "./routers/licenseEnforcement";
import { limitsRouter } from "./routers/limits";
import { llmModelCostsRouter } from "./routers/llmModelCosts";
import { modelProviderRouter } from "./routers/modelProviders";
import { monitorsRouter } from "./routers/monitors";
import { onboardingRouter } from "./routers/onboarding/onboarding.router";
import { opsRouter } from "./routers/ops";
import { optimizationRouter } from "./routers/optimization";
import { organizationRouter } from "./routers/organization";
import { personalVirtualKeysRouter } from "./routers/personalVirtualKeys";
import { personalWorkspaceFeaturesRouter } from "./routers/personalWorkspaceFeatures";
import { pinnedTraceRouter } from "./routers/pinnedTrace";
import { planRouter } from "./routers/plan";
import { presenceRouter } from "./routers/presence";
import { projectRouter } from "./routers/project";
import { promptTagsRouter } from "./routers/prompt-tags.trpc-router";
import { promptsRouter } from "./routers/prompts";
import { publicEnvRouter } from "./routers/publicEnv";
import { roleRouter } from "./routers/role";
import { roleBindingRouter } from "./routers/roleBinding";
import { routingPoliciesRouter } from "./routers/routingPolicies";
import { savedViewsRouter } from "./routers/savedViews";
import { scenarioRouter } from "./routers/scenarios";
import { scimTokenRouter } from "./routers/scimToken";
import { sdkRadarRouter } from "./routers/sdkRadar";
import { secretsRouter } from "./routers/secrets";
import { shareRouter } from "./routers/share";
import { spansRouter } from "./routers/spans";
import { storedObjectsRouter } from "./routers/stored-objects.router";
import { subscriptionRouter } from "./routers/subscription";
import { suiteRouter } from "./routers/suites";
import { teamRouter } from "./routers/team";
import { topicsRouter } from "./routers/topics";
import { tracesRouter } from "./routers/traces";
import { tracesV2Router } from "./routers/tracesV2";
import { translateRouter } from "./routers/translate";
import { userRouter } from "./routers/user";
import { virtualKeysRouter } from "./routers/virtualKeys";
import { workflowRouter } from "./routers/workflows";

const coreRouters = {
  agents: agentsRouter,
  evaluators: evaluatorsRouter,
  httpProxy: httpProxyRouter,
  organization: organizationRouter,
  project: projectRouter,
  team: teamRouter,
  traces: tracesRouter,
  tracesV2: tracesV2Router,
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
  experiments: experimentsRouter,
  featureFlag: featureFlagRouter,
  annotation: annotationRouter,
  modelProvider: modelProviderRouter,
  llmModelCost: llmModelCostsRouter,
  user: userRouter,
  annotationScore: annotationScoreRouter,
  publicEnv: publicEnvRouter,
  share: shareRouter,
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
  sdkRadar: sdkRadarRouter,
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
  langyGithub: langyGithubRouter,
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
