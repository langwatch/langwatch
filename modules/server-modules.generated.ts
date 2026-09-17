/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { agentServer } from "@langwatch/agent-server";
import { analyticsServer } from "@langwatch/analytics-server";
import { annotationServer } from "@langwatch/annotation-server";
import { apiKeyServer } from "@langwatch/api-key-server";
import { authServer } from "@langwatch/auth-server";
import { authzServer } from "@langwatch/authz-server";
import { automationServer } from "@langwatch/automation-server";
import { codingAgentServer } from "@langwatch/coding-agent-server";
import { dashboardServer } from "@langwatch/dashboard-server";
import { dataPrivacyServer } from "@langwatch/data-privacy-server";
import { dataRetentionServer } from "@langwatch/data-retention-server";
import { datasetServer } from "@langwatch/dataset-server";
import { entitlementServer } from "@langwatch/entitlement-server";
import { evaluationServer } from "@langwatch/evaluation-server";
import { evaluatorServer } from "@langwatch/evaluator-server";
import { experimentServer } from "@langwatch/experiment-server";
import { featureFlagServer } from "@langwatch/feature-flag-server";
import { gatewayServer } from "@langwatch/gateway-server";
import { githubServer } from "@langwatch/github-server";
import { governanceServer } from "@langwatch/enterprise-governance-server";
import { hostedMcpServer } from "@langwatch/hosted-mcp-server";
import { identityServer } from "@langwatch/identity-server";
import { langyServer } from "@langwatch/langy-server";
import { licensingServer } from "@langwatch/enterprise-licensing-server";
import { logServer } from "@langwatch/log-server";
import { managedProviderServer } from "@langwatch/enterprise-managed-provider-server";
import { metricServer } from "@langwatch/metric-server";
import { modelProviderServer } from "@langwatch/model-provider-server";
import { monitorServer } from "@langwatch/monitor-server";
import { notificationServer } from "@langwatch/notification-server";
import { opsServer } from "@langwatch/ops-server";
import { organizationServer } from "@langwatch/organization-server";
import { platformHealthServer } from "@langwatch/platform-health-server";
import { presenceServer } from "@langwatch/presence-server";
import { projectServer } from "@langwatch/project-server";
import { promptServer } from "@langwatch/prompt-server";
import { roleServer } from "@langwatch/role-server";
import { scenarioServer } from "@langwatch/scenario-server";
import { scimServer } from "@langwatch/enterprise-scim-server";
import { secretServer } from "@langwatch/secret-server";
import { shareServer } from "@langwatch/share-server";
import { ssoServer } from "@langwatch/enterprise-sso-server";
import { storedObjectServer } from "@langwatch/stored-object-server";
import { suiteServer } from "@langwatch/suite-server";
import { topicServer } from "@langwatch/topic-server";
import { traceServer } from "@langwatch/trace-server";
import { userServer } from "@langwatch/user-server";
import { webhookServer } from "@langwatch/webhook-server";
import { workflowServer } from "@langwatch/workflow-server";

/** Every installed module's server declaration, in name order. */
export const serverModules = [
  agentServer,
  analyticsServer,
  annotationServer,
  apiKeyServer,
  authServer,
  authzServer,
  automationServer,
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
  langyServer,
  licensingServer,
  logServer,
  managedProviderServer,
  metricServer,
  modelProviderServer,
  monitorServer,
  notificationServer,
  opsServer,
  organizationServer,
  platformHealthServer,
  presenceServer,
  projectServer,
  promptServer,
  roleServer,
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

/** Compiler-sized batches of the same ordered module graph. */
export const serverModuleBatch0 = [agentServer, analyticsServer, annotationServer, apiKeyServer, authServer] as const;
export const serverModuleBatch1 = [authzServer, automationServer, codingAgentServer, dashboardServer, dataPrivacyServer] as const;
export const serverModuleBatch2 = [dataRetentionServer, datasetServer, entitlementServer, evaluationServer, evaluatorServer] as const;
export const serverModuleBatch3 = [experimentServer, featureFlagServer, gatewayServer, githubServer, governanceServer] as const;
export const serverModuleBatch4 = [hostedMcpServer, identityServer, langyServer, licensingServer, logServer] as const;
export const serverModuleBatch5 = [managedProviderServer, metricServer, modelProviderServer, monitorServer, notificationServer] as const;
export const serverModuleBatch6 = [opsServer, organizationServer, platformHealthServer, presenceServer, projectServer] as const;
export const serverModuleBatch7 = [promptServer, roleServer, scenarioServer, scimServer, secretServer] as const;
export const serverModuleBatch8 = [shareServer, ssoServer, storedObjectServer, suiteServer, topicServer] as const;
export const serverModuleBatch9 = [traceServer, userServer, webhookServer, workflowServer] as const;
