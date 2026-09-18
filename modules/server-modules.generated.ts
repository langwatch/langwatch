/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { createApp, type ServerRole } from "@langwatch/kernel";
import { agentServer } from "@langwatch/agent-process";
import { analyticsServer } from "@langwatch/analytics-process";
import { annotationServer } from "@langwatch/annotation-process";
import { apiKeyServer } from "@langwatch/api-key-process";
import { authServer } from "@langwatch/auth-process";
import { authzServer } from "@langwatch/authz-process";
import { automationServer } from "@langwatch/automation-process";
import { codingAgentServer } from "@langwatch/coding-agent-process";
import { dashboardServer } from "@langwatch/dashboard-process";
import { dataPrivacyServer } from "@langwatch/data-privacy-process";
import { dataRetentionServer } from "@langwatch/data-retention-process";
import { datasetServer } from "@langwatch/dataset-process";
import { entitlementServer } from "@langwatch/entitlement-process";
import { evaluationServer } from "@langwatch/evaluation-process";
import { evaluatorServer } from "@langwatch/evaluator-process";
import { experimentServer } from "@langwatch/experiment-process";
import { featureFlagServer } from "@langwatch/feature-flag-process";
import { gatewayServer } from "@langwatch/gateway-process";
import { githubServer } from "@langwatch/github-process";
import { governanceServer } from "@langwatch/enterprise-governance-process";
import { hostedMcpServer } from "@langwatch/hosted-mcp-process";
import { identityServer } from "@langwatch/identity-process";
import { langyServer } from "@langwatch/langy-process";
import { licensingServer } from "@langwatch/enterprise-licensing-process";
import { logServer } from "@langwatch/log-process";
import { managedProviderServer } from "@langwatch/enterprise-managed-provider-process";
import { metricServer } from "@langwatch/metric-process";
import { modelProviderServer } from "@langwatch/model-provider-process";
import { monitorServer } from "@langwatch/monitor-process";
import { notificationServer } from "@langwatch/notification-process";
import { opsServer } from "@langwatch/ops-process";
import { organizationServer } from "@langwatch/organization-process";
import { platformHealthServer } from "@langwatch/platform-health-process";
import { presenceServer } from "@langwatch/presence-process";
import { projectServer } from "@langwatch/project-process";
import { promptServer } from "@langwatch/prompt-process";
import { roleServer } from "@langwatch/role-process";
import { scenarioServer } from "@langwatch/scenario-process";
import { scimServer } from "@langwatch/enterprise-scim-process";
import { secretServer } from "@langwatch/secret-process";
import { shareServer } from "@langwatch/share-process";
import { ssoServer } from "@langwatch/enterprise-sso-process";
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

/** The same graph by tier, so a build states which tiers it installs. */
export const coreServerModules = [agentServer, analyticsServer, annotationServer, apiKeyServer, authServer, authzServer, automationServer, codingAgentServer, dashboardServer, dataPrivacyServer, dataRetentionServer, datasetServer, entitlementServer, evaluationServer, evaluatorServer, experimentServer, featureFlagServer, gatewayServer, githubServer, hostedMcpServer, identityServer, langyServer, logServer, metricServer, modelProviderServer, monitorServer, notificationServer, opsServer, organizationServer, platformHealthServer, presenceServer, projectServer, promptServer, roleServer, scenarioServer, secretServer, shareServer, storedObjectServer, suiteServer, topicServer, traceServer, userServer, webhookServer, workflowServer] as const;
export const enterpriseServerModules = [governanceServer, licensingServer, managedProviderServer, scimServer, ssoServer] as const;

/**
 * The graph in chunks, and the chain that installs it. TypeScript cannot
 * instantiate 49 modules in one `withModules` call (TS2589), so the chain
 * is generated here and a process installs everything with one call.
 */
export const serverModuleChunk0 = [agentServer, analyticsServer, annotationServer, apiKeyServer, authServer] as const;
export const serverModuleChunk1 = [authzServer, automationServer, codingAgentServer, dashboardServer, dataPrivacyServer] as const;
export const serverModuleChunk2 = [dataRetentionServer, datasetServer, entitlementServer, evaluationServer, evaluatorServer] as const;
export const serverModuleChunk3 = [experimentServer, featureFlagServer, gatewayServer, githubServer, governanceServer] as const;
export const serverModuleChunk4 = [hostedMcpServer, identityServer, langyServer, licensingServer, logServer] as const;
export const serverModuleChunk5 = [managedProviderServer, metricServer, modelProviderServer, monitorServer, notificationServer] as const;
export const serverModuleChunk6 = [opsServer, organizationServer, platformHealthServer, presenceServer, projectServer] as const;
export const serverModuleChunk7 = [promptServer, roleServer, scenarioServer, scimServer, secretServer] as const;
export const serverModuleChunk8 = [shareServer, ssoServer, storedObjectServer, suiteServer, topicServer] as const;
export const serverModuleChunk9 = [traceServer, userServer, webhookServer, workflowServer] as const;

export const createServerApp = (role: ServerRole) =>
  createApp({ role })
    .withModules(serverModuleChunk0)
    .withModules(serverModuleChunk1)
    .withModules(serverModuleChunk2)
    .withModules(serverModuleChunk3)
    .withModules(serverModuleChunk4)
    .withModules(serverModuleChunk5)
    .withModules(serverModuleChunk6)
    .withModules(serverModuleChunk7)
    .withModules(serverModuleChunk8)
    .withModules(serverModuleChunk9);
