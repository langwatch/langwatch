import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioServerConfig } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets, SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { WorkflowApi } from "@langwatch/workflow-contract";

/** A deployment with no telemetry endpoint: the executor is never composed. */
export const scenarioTestConfig: ScenarioServerConfig = {
  langwatchEndpoint: void 0,
  voicePublicBaseUrl: void 0,
  voiceCallMaxSeconds: void 0,
  blockLocalHttpCalls: true,
  allowedProxyHosts: [],
  defaultModel: void 0,
  nlpTimeouts: { maxTimeoutMs: void 0 },
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
  nlpCodeBlockTimeoutSeconds: void 0,
  isSaas: false,
  nodeEnvironment: "test",
};

/** The voice doors' peers, each throwing by name if a test reaches it. */
export function scenarioVoicePeers() {
  return {
    authz: createApiFixture<AuthzApi>({}, "Authz"),
    gateway: createApiFixture<GatewayApi>({}, "Gateway"),
  };
}

/** A deployment whose every declared secret is unset. */
export const scenarioTestSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/** The installed module's secrets, resolved from an environment that sets none. */
export function scenarioInstallationSecrets() {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());
  return (owner: string, declared: Parameters<SecretsResolver["scopeTo"]>[1]) =>
    resolver.scopeTo(owner, declared);
}
