/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { agentServerConfigSchema } from "@langwatch/agent-contract";
import { analyticsServerConfigSchema } from "@langwatch/analytics-contract";
import { apiKeyServerConfigSchema } from "@langwatch/api-key-contract";
import { authServerConfigSchema } from "@langwatch/auth-contract";
import { authzServerConfigSchema } from "@langwatch/authz-contract";
import { automationServerConfigSchema } from "@langwatch/automation-contract";
import { billingServerConfigSchema } from "@langwatch/enterprise-billing-contract";
import { dataPrivacyServerConfigSchema } from "@langwatch/data-privacy-contract";
import { dataRetentionServerConfigSchema } from "@langwatch/data-retention-contract";
import { evaluationServerConfigSchema } from "@langwatch/evaluation-contract";
import { featureFlagServerConfigSchema } from "@langwatch/feature-flag-contract";
import { gatewayServerConfigSchema } from "@langwatch/gateway-contract";
import { githubServerConfigSchema } from "@langwatch/github-contract";
import { langyServerConfigSchema } from "@langwatch/langy-contract";
import { licensingServerConfigSchema } from "@langwatch/enterprise-licensing-contract";
import { logServerConfigSchema } from "@langwatch/log-contract";
import { managedProviderServerConfigSchema } from "@langwatch/enterprise-managed-provider-contract";
import { metricServerConfigSchema } from "@langwatch/metric-contract";
import { modelProviderServerConfigSchema } from "@langwatch/model-provider-contract";
import { notificationServerConfigSchema } from "@langwatch/notification-contract";
import { opsServerConfigSchema } from "@langwatch/ops-contract";
import { platformHealthServerConfigSchema } from "@langwatch/platform-health-contract";
import { saasServerConfigSchema } from "@langwatch/enterprise-saas-contract";
import { scimServerConfigSchema } from "@langwatch/enterprise-scim-contract";
import { secretServerConfigSchema } from "@langwatch/secret-contract";
import { storedObjectServerConfigSchema } from "@langwatch/stored-object-contract";
import { traceServerConfigSchema } from "@langwatch/trace-contract";
import { webhookServerConfigSchema } from "@langwatch/webhook-contract";
import { workflowServerConfigSchema } from "@langwatch/workflow-contract";

/**
 * Every installed module that declares a config schema, in name order,
 * re-exported from the module's own declaration. A module that declares
 * none contributes no key here and no root key on the parsed config.
 */
export const installedModuleConfigs = {
  agent: agentServerConfigSchema,
  analytics: analyticsServerConfigSchema,
  "api-key": apiKeyServerConfigSchema,
  auth: authServerConfigSchema,
  authz: authzServerConfigSchema,
  automation: automationServerConfigSchema,
  billing: billingServerConfigSchema,
  "data-privacy": dataPrivacyServerConfigSchema,
  "data-retention": dataRetentionServerConfigSchema,
  evaluation: evaluationServerConfigSchema,
  "feature-flag": featureFlagServerConfigSchema,
  gateway: gatewayServerConfigSchema,
  github: githubServerConfigSchema,
  langy: langyServerConfigSchema,
  licensing: licensingServerConfigSchema,
  log: logServerConfigSchema,
  "managed-provider": managedProviderServerConfigSchema,
  metric: metricServerConfigSchema,
  "model-provider": modelProviderServerConfigSchema,
  notification: notificationServerConfigSchema,
  ops: opsServerConfigSchema,
  "platform-health": platformHealthServerConfigSchema,
  saas: saasServerConfigSchema,
  scim: scimServerConfigSchema,
  secret: secretServerConfigSchema,
  "stored-object": storedObjectServerConfigSchema,
  trace: traceServerConfigSchema,
  webhook: webhookServerConfigSchema,
  workflow: workflowServerConfigSchema,
} as const;
