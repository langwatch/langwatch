/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { agentProcessModule } from "@langwatch/agent-process";
import { analyticsProcessModule } from "@langwatch/analytics-process";
import { annotationProcessModule } from "@langwatch/annotation-process";
import { apiKeyProcessModule } from "@langwatch/api-key-process";
import { auditLogProcessModule } from "@langwatch/audit-log-process";
import { authProcessModule } from "@langwatch/auth-process";
import { authzProcessModule } from "@langwatch/authz-process";
import { automationProcessModule } from "@langwatch/automation-process";
import { billingProcessModule } from "@langwatch/enterprise-billing-process";
import { codingAgentProcessModule } from "@langwatch/coding-agent-process";
import { dashboardProcessModule } from "@langwatch/dashboard-process";
import { dataPrivacyProcessModule } from "@langwatch/data-privacy-process";
import { dataRetentionProcessModule } from "@langwatch/data-retention-process";
import { datasetProcessModule } from "@langwatch/dataset-process";
import { demoDataProcessModule } from "@langwatch/enterprise-demo-data-process";
import { enterpriseGatewayProcessModule } from "@langwatch/enterprise-gateway-process";
import { enterpriseOpsProcessModule } from "@langwatch/enterprise-ops-process";
import { entitlementProcessModule } from "@langwatch/entitlement-process";
import { evaluationProcessModule } from "@langwatch/evaluation-process";
import { evaluatorProcessModule } from "@langwatch/evaluator-process";
import { experimentProcessModule } from "@langwatch/experiment-process";
import { featureFlagProcessModule } from "@langwatch/feature-flag-process";
import { gatewayProcessModule } from "@langwatch/gateway-process";
import { githubProcessModule } from "@langwatch/github-process";
import { governanceProcessModule } from "@langwatch/enterprise-governance-process";
import { hostedMcpProcessModule } from "@langwatch/hosted-mcp-process";
import { identityProcessModule } from "@langwatch/identity-process";
import { instantEvalProcessModule } from "@langwatch/instant-eval-process";
import { langyProcessModule } from "@langwatch/langy-process";
import { licensingProcessModule } from "@langwatch/enterprise-licensing-process";
import { logProcessModule } from "@langwatch/log-process";
import { managedProviderProcessModule } from "@langwatch/enterprise-managed-provider-process";
import { metricProcessModule } from "@langwatch/metric-process";
import { modelProviderProcessModule } from "@langwatch/model-provider-process";
import { monitorProcessModule } from "@langwatch/monitor-process";
import { notificationProcessModule } from "@langwatch/notification-process";
import { nurturingProcessModule } from "@langwatch/enterprise-nurturing-process";
import { onboardingProcessModule } from "@langwatch/onboarding-process";
import { opsProcessModule } from "@langwatch/ops-process";
import { organizationProcessModule } from "@langwatch/organization-process";
import { platformHealthProcessModule } from "@langwatch/platform-health-process";
import { presenceProcessModule } from "@langwatch/presence-process";
import { projectProcessModule } from "@langwatch/project-process";
import { promptProcessModule } from "@langwatch/prompt-process";
import { roleProcessModule } from "@langwatch/role-process";
import { rumProcessModule } from "@langwatch/rum-process";
import { saasProcessModule } from "@langwatch/enterprise-saas-process";
import { sampleAgentsProcessModule } from "@langwatch/sample-agents-process";
import { scenarioProcessModule } from "@langwatch/scenario-process";
import { scimProcessModule } from "@langwatch/enterprise-scim-process";
import { secretProcessModule } from "@langwatch/secret-process";
import { shareProcessModule } from "@langwatch/share-process";
import { slackProcessModule } from "@langwatch/slack-process";
import { ssoProcessModule } from "@langwatch/enterprise-sso-process";
import { storedObjectProcessModule } from "@langwatch/stored-object-process";
import { suiteProcessModule } from "@langwatch/suite-process";
import { topicProcessModule } from "@langwatch/topic-process";
import { traceProcessModule } from "@langwatch/trace-process";
import { usageProcessModule } from "@langwatch/usage-process";
import { userProcessModule } from "@langwatch/user-process";
import { webhookProcessModule } from "@langwatch/webhook-process";
import { workflowProcessModule } from "@langwatch/workflow-process";

/** Every installed module's server declaration, in name order. */
export const processModules = [
  agentProcessModule,
  analyticsProcessModule,
  annotationProcessModule,
  apiKeyProcessModule,
  auditLogProcessModule,
  authProcessModule,
  authzProcessModule,
  automationProcessModule,
  billingProcessModule,
  codingAgentProcessModule,
  dashboardProcessModule,
  dataPrivacyProcessModule,
  dataRetentionProcessModule,
  datasetProcessModule,
  demoDataProcessModule,
  enterpriseGatewayProcessModule,
  enterpriseOpsProcessModule,
  entitlementProcessModule,
  evaluationProcessModule,
  evaluatorProcessModule,
  experimentProcessModule,
  featureFlagProcessModule,
  gatewayProcessModule,
  githubProcessModule,
  governanceProcessModule,
  hostedMcpProcessModule,
  identityProcessModule,
  instantEvalProcessModule,
  langyProcessModule,
  licensingProcessModule,
  logProcessModule,
  managedProviderProcessModule,
  metricProcessModule,
  modelProviderProcessModule,
  monitorProcessModule,
  notificationProcessModule,
  nurturingProcessModule,
  onboardingProcessModule,
  opsProcessModule,
  organizationProcessModule,
  platformHealthProcessModule,
  presenceProcessModule,
  projectProcessModule,
  promptProcessModule,
  roleProcessModule,
  rumProcessModule,
  saasProcessModule,
  sampleAgentsProcessModule,
  scenarioProcessModule,
  scimProcessModule,
  secretProcessModule,
  shareProcessModule,
  slackProcessModule,
  ssoProcessModule,
  storedObjectProcessModule,
  suiteProcessModule,
  topicProcessModule,
  traceProcessModule,
  usageProcessModule,
  userProcessModule,
  webhookProcessModule,
  workflowProcessModule,
] as const;
