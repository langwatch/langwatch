/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { agentServer } from "@langwatch/agent-process";
import { analyticsServer } from "@langwatch/analytics-process";
import { annotationServer } from "@langwatch/annotation-process";
import { apiKeyServer } from "@langwatch/api-key-process";
import { auditLogServer } from "@langwatch/audit-log-process";
import { authServer } from "@langwatch/auth-process";
import { authzServer } from "@langwatch/authz-process";
import { automationServer } from "@langwatch/automation-process";
import { codingAgentServer } from "@langwatch/coding-agent-process";
import { dashboardServer } from "@langwatch/dashboard-process";
import { dataPrivacyServer } from "@langwatch/data-privacy-process";
import { dataRetentionServer } from "@langwatch/data-retention-process";
import { datasetServer } from "@langwatch/dataset-process";
import { billingServer } from "@langwatch/enterprise-billing-process";
import { governanceServer } from "@langwatch/enterprise-governance-process";
import { licensingServer } from "@langwatch/enterprise-licensing-process";
import { managedProviderServer } from "@langwatch/enterprise-managed-provider-process";
import { saasServer } from "@langwatch/enterprise-saas-process";
import { scimServer } from "@langwatch/enterprise-scim-process";
import { ssoServer } from "@langwatch/enterprise-sso-process";
import { entitlementServer } from "@langwatch/entitlement-process";
import { evaluationServer } from "@langwatch/evaluation-process";
import { evaluatorServer } from "@langwatch/evaluator-process";
import { experimentServer } from "@langwatch/experiment-process";
import { featureFlagServer } from "@langwatch/feature-flag-process";
import { gatewayServer } from "@langwatch/gateway-process";
import { githubServer } from "@langwatch/github-process";
import { hostedMcpServer } from "@langwatch/hosted-mcp-process";
import { identityServer } from "@langwatch/identity-process";
import { instantEvalServer } from "@langwatch/instant-eval-process";
import { langyServer } from "@langwatch/langy-process";
import { logServer } from "@langwatch/log-process";
import { metricServer } from "@langwatch/metric-process";
import { modelProviderServer } from "@langwatch/model-provider-process";
import { monitorServer } from "@langwatch/monitor-process";
import { notificationServer } from "@langwatch/notification-process";
import { onboardingServer } from "@langwatch/onboarding-process";
import { opsServer } from "@langwatch/ops-process";
import { organizationServer } from "@langwatch/organization-process";
import { platformHealthServer } from "@langwatch/platform-health-process";
import { presenceServer } from "@langwatch/presence-process";
import { projectServer } from "@langwatch/project-process";
import { promptServer } from "@langwatch/prompt-process";
import { roleServer } from "@langwatch/role-process";
import { scenarioServer } from "@langwatch/scenario-process";
import { secretServer } from "@langwatch/secret-process";
import { shareServer } from "@langwatch/share-process";
import { storedObjectServer } from "@langwatch/stored-object-process";
import { suiteServer } from "@langwatch/suite-process";
import { topicServer } from "@langwatch/topic-process";
import { traceServer } from "@langwatch/trace-process";
import { userServer } from "@langwatch/user-process";
import { webhookServer } from "@langwatch/webhook-process";
import { workflowServer } from "@langwatch/workflow-process";

/** Every installed module's server declaration, in name order. */
export const serverModules = [
  agentServer,
  analyticsServer,
  annotationServer,
  apiKeyServer,
  auditLogServer,
  authServer,
  authzServer,
  automationServer,
  billingServer,
  codingAgentServer,
  dashboardServer,
  dataPrivacyServer,
  dataRetentionServer,
  datasetServer,
  entitlementServer,
  evaluationServer,
  evaluatorServer,
  experimentServer,
  featureFlagServer,
  gatewayServer,
  githubServer,
  governanceServer,
  hostedMcpServer,
  identityServer,
  instantEvalServer,
  langyServer,
  licensingServer,
  logServer,
  managedProviderServer,
  metricServer,
  modelProviderServer,
  monitorServer,
  notificationServer,
  onboardingServer,
  opsServer,
  organizationServer,
  platformHealthServer,
  presenceServer,
  projectServer,
  promptServer,
  roleServer,
  saasServer,
  scenarioServer,
  scimServer,
  secretServer,
  shareServer,
  ssoServer,
  storedObjectServer,
  suiteServer,
  topicServer,
  traceServer,
  userServer,
  webhookServer,
  workflowServer,
] as const;
