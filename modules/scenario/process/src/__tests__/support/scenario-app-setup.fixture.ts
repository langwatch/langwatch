import { createApiFixture } from "@langwatch/api-fixture";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioServerConfig } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

/** A deployment with no telemetry endpoint: the executor is never composed. */
export const scenarioTestConfig: ScenarioServerConfig = {
  langwatchEndpoint: void 0,
  voicePublicBaseUrl: void 0,
  blockLocalHttpCalls: true,
  allowedProxyHosts: [],
  defaultModel: void 0,
  childParentEnvironment: {
    path: void 0,
    home: void 0,
    user: void 0,
    shell: void 0,
    lang: void 0,
    lcAll: void 0,
    term: void 0,
    nodeCompileCache: void 0,
    corepackEnableDownloadPrompt: void 0,
    nodeExtraCaCerts: void 0,
  },
};

/** The executor's peers, each throwing by name if a test reaches it. */
export function scenarioExecutorPeers() {
  return {
    prompts: createApiFixture<PromptApi>(),
    secrets: createApiFixture<SecretApi>(),
    workflows: createApiFixture<WorkflowApi>(),
  };
}

/** The process facts a child is started with, as a test process answers them. */
export const scenarioHostMembers = {
  nlpServiceUrl: void 0,
  isSaas: false,
  nodeEnvironment: "test",
};
