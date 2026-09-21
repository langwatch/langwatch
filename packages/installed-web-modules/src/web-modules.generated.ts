/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { agentWeb } from "@langwatch/agent-browser/declaration";
import { analyticsWeb } from "@langwatch/analytics-browser/declaration";
import { annotationWeb } from "@langwatch/annotation-browser/declaration";
import { apiKeyWeb } from "@langwatch/api-key-browser/declaration";
import { authWeb } from "@langwatch/auth-browser/declaration";
import { authzWeb } from "@langwatch/authz-browser/declaration";
import { automationWeb } from "@langwatch/automation-browser/declaration";
import { billingWeb } from "@langwatch/enterprise-billing-browser/declaration";
import { codingAgentWeb } from "@langwatch/coding-agent-browser/declaration";
import { dataPrivacyWeb } from "@langwatch/data-privacy-browser/declaration";
import { dataRetentionWeb } from "@langwatch/data-retention-browser/declaration";
import { datasetWeb } from "@langwatch/dataset-browser/declaration";
import { evaluatorWeb } from "@langwatch/evaluator-browser/declaration";
import { experimentWeb } from "@langwatch/experiment-browser/declaration";
import { featureFlagWeb } from "@langwatch/feature-flag-browser/declaration";
import { gatewayWeb } from "@langwatch/gateway-browser/declaration";
import { githubWeb } from "@langwatch/github-browser/declaration";
import { governanceWeb } from "@langwatch/enterprise-governance-browser/declaration";
import { langyWeb } from "@langwatch/langy-browser/declaration";
import { licensingWeb } from "@langwatch/enterprise-licensing-browser/declaration";
import { modelProviderWeb } from "@langwatch/model-provider-browser/declaration";
import { monitorWeb } from "@langwatch/monitor-browser/declaration";
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { notificationWeb } from "@langwatch/notification-browser/declaration";
import { onboardingWeb } from "@langwatch/onboarding-browser/declaration";
import { opsWeb } from "@langwatch/ops-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { presenceWeb } from "@langwatch/presence-browser/declaration";
import { projectWeb } from "@langwatch/project-browser/declaration";
import { promptWeb } from "@langwatch/prompt-browser/declaration";
import { scenarioWeb } from "@langwatch/scenario-browser/declaration";
import { scimWeb } from "@langwatch/enterprise-scim-browser/declaration";
import { secretWeb } from "@langwatch/secret-browser/declaration";
import { shareWeb } from "@langwatch/share-browser/declaration";
import { suiteWeb } from "@langwatch/suite-browser/declaration";
import { topicWeb } from "@langwatch/topic-browser/declaration";
import { traceWeb } from "@langwatch/trace-browser/declaration";
import { userWeb } from "@langwatch/user-browser/declaration";
import { workflowWeb } from "@langwatch/workflow-browser/declaration";

/** Every installed module's web declaration, in name order. */
export const webModules = [
  agentWeb satisfies { readonly name: "agent" },
  analyticsWeb satisfies { readonly name: "analytics" },
  annotationWeb satisfies { readonly name: "annotation" },
  apiKeyWeb satisfies { readonly name: "api-key" },
  authWeb satisfies { readonly name: "auth" },
  authzWeb satisfies { readonly name: "authz" },
  automationWeb satisfies { readonly name: "automation" },
  billingWeb satisfies { readonly name: "billing" },
  codingAgentWeb satisfies { readonly name: "coding-agent" },
  dataPrivacyWeb satisfies { readonly name: "data-privacy" },
  dataRetentionWeb satisfies { readonly name: "data-retention" },
  datasetWeb satisfies { readonly name: "dataset" },
  evaluatorWeb satisfies { readonly name: "evaluator" },
  experimentWeb satisfies { readonly name: "experiment" },
  featureFlagWeb satisfies { readonly name: "feature-flag" },
  gatewayWeb satisfies { readonly name: "gateway" },
  githubWeb satisfies { readonly name: "github" },
  governanceWeb satisfies { readonly name: "governance" },
  langyWeb satisfies { readonly name: "langy" },
  licensingWeb satisfies { readonly name: "licensing" },
  modelProviderWeb satisfies { readonly name: "model-provider" },
  monitorWeb satisfies { readonly name: "monitor" },
  navigationWeb satisfies { readonly name: "navigation" },
  notificationWeb satisfies { readonly name: "notification" },
  onboardingWeb satisfies { readonly name: "onboarding" },
  opsWeb satisfies { readonly name: "ops" },
  organizationWeb satisfies { readonly name: "organization" },
  presenceWeb satisfies { readonly name: "presence" },
  projectWeb satisfies { readonly name: "project" },
  promptWeb satisfies { readonly name: "prompt" },
  scenarioWeb satisfies { readonly name: "scenario" },
  scimWeb satisfies { readonly name: "scim" },
  secretWeb satisfies { readonly name: "secret" },
  shareWeb satisfies { readonly name: "share" },
  suiteWeb satisfies { readonly name: "suite" },
  topicWeb satisfies { readonly name: "topic" },
  traceWeb satisfies { readonly name: "trace" },
  userWeb satisfies { readonly name: "user" },
  workflowWeb satisfies { readonly name: "workflow" },
] as const;
type PairedOnDisk = "agent" | "analytics" | "annotation" | "api-key" | "auth" | "authz" | "automation" | "coding-agent" | "data-privacy" | "data-retention" | "dataset" | "evaluator" | "experiment" | "feature-flag" | "gateway" | "github" | "langy" | "model-provider" | "monitor" | "notification" | "onboarding" | "ops" | "organization" | "presence" | "project" | "prompt" | "scenario" | "secret" | "share" | "suite" | "topic" | "trace" | "user" | "workflow" | "billing" | "governance" | "licensing" | "scim";
type ServerHalfOnDisk = "agent" | "analytics" | "annotation" | "api-key" | "auth" | "authz" | "automation" | "coding-agent" | "dashboard" | "data-privacy" | "data-retention" | "dataset" | "entitlement" | "evaluation" | "evaluator" | "experiment" | "feature-flag" | "gateway" | "github" | "governance" | "hosted-mcp" | "identity" | "instant-eval" | "langy" | "licensing" | "log" | "managed-provider" | "metric" | "model-provider" | "monitor" | "notification" | "onboarding" | "ops" | "organization" | "platform-health" | "presence" | "project" | "prompt" | "role" | "scenario" | "scim" | "secret" | "share" | "sso" | "stored-object" | "suite" | "topic" | "trace" | "user" | "webhook" | "workflow";
type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number]["name"]>;
type MissingServer = Exclude<PairedOnDisk, ServerHalfOnDisk>;
export const webModulePairing = {} satisfies {
  [Id in `missing web half "${MissingWeb}"` | `missing server half "${MissingServer}"`]: never;
};
