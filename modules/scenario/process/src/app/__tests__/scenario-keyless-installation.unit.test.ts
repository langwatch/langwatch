/**
 * @vitest-environment node
 * The scenario feature booted on a deployment that configured no encryption key.
 */
import { EventEmitter } from "node:events";

import { type AgentApi, AgentNotFoundError } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { memoryStores, openStores, PipelineParticipation } from "@langwatch/process-stores";
import { storesOwner, type StoresConfig } from "@langwatch/process-stores/config";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  scenarioInstallationSecrets,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import { scenarioProcessModule } from "../../scenario.module.ts";
import type { ScenarioReadOnlyClickHouse } from "../scenario.app.ts";

const projectId = "project-1";

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-keyless-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** The encryption member exactly as a process with no key builds it. */
async function keylessEncryption() {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());
  const { members } = await openStores({
    name: "scenario-keyless-test",
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  return members.read("encryption");
}

const encryption = await keylessEncryption();

const unconfiguredEncryption = { name: "MemberNotConfiguredError", member: "encryption" };

function process(role: "api" | "worker", emitter: EventEmitter) {
  return createApp({ role, secrets: scenarioInstallationSecrets() })
    .withModules([withMemoryRepositories(scenarioProcessModule)])
    .withConfig({ scenario: scenarioTestConfig })
    .withStores(memoryStores())
    .withAnalytical(createApiFixture<ScenarioReadOnlyClickHouse>())
    .withKeyvalue(memoryRedisDouble())
    .withMember("encryption", encryption)
    .withMember("rateLimiter", { check: async () => ({ allowed: true }) })
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("nlpServiceUrl", undefined)
    .withMember("nlpCodeBlockTimeoutSeconds", undefined)
    .withMember("isSaas", false)
    .withMember("nodeEnvironment", "test")
    .withMember("rawSocketPort", 0)
    .provide({
      agent: createApiFixture<AgentApi>({
        getById: async ({ id }) => {
          throw new AgentNotFoundError(id, projectId);
        },
      }),
      user: createApiFixture<UserApi>(),
      project: createApiFixture<ProjectApi>({
        findById: async () => null,
        getOrganizationId: async () => "organization-1",
      }),
      entitlement: createApiFixture<EntitlementApi>({ assertWithinUsageLimit: async () => {} }),
      "model-provider": createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>({
        getTenantEmitter: () => emitter,
        cleanupTenantEmitter: () => {},
      }),
      "audit-log": createApiFixture<AuditLogApi>(),
      trace: createApiFixture<TraceApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
      suite: createApiFixture<SuiteApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      prompt: createApiFixture<PromptApi>(),
      secret: createApiFixture<SecretApi>(),
      workflow: createApiFixture<WorkflowApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      authz: createApiFixture<AuthzApi>(),
      gateway: createApiFixture<GatewayApi>(),
      "api-key": createApiFixture<ApiKeyApi>(),
    });
}

describe("given a deployment that configured no stored-secret encryption key", () => {
  /**
   * @scenario "The missing key refuses each secret use, never the boot"
   * @scenario "The scenario surfaces still answer"
   */
  it("boots and lists the project's scenarios", async () => {
    const runtime = await process("api", new EventEmitter()).boot();

    try {
      await expect(runtime.service(ScenarioApi).list({ projectId })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The surfaces that never read the cipher are untouched" */
  it("lists the project's suites", async () => {
    const runtime = await process("api", new EventEmitter()).boot();

    try {
      await expect(runtime.service(ScenarioApi).listTestSuites({ projectId })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /**
   * @scenario "Writing a scenario secret refuses by name"
   * @scenario "The missing key refuses each secret use, never the boot"
   */
  it("refuses saving a stored secret as the unconfigured encryption member", async () => {
    const runtime = await process("api", new EventEmitter()).boot();

    try {
      await expect(
        runtime.service(ScenarioApi).resolveRunParametersForScenarios({
          scenarios: [
            {
              id: "scenario-1",
              name: "Refund flow",
              version: 1,
              situation: "A customer asks for help",
              criteria: [],
              parameters: [{ name: "api_token", secret: true }],
            },
          ],
          values: { api_token: "token-live" },
        }),
      ).rejects.toMatchObject(unconfiguredEncryption);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "The missing key refuses each secret use, never the boot" */
  it("refuses reading a stored secret back for a run", async () => {
    const runtime = await process("api", new EventEmitter()).boot();

    try {
      const prefetched = await runtime.service(ScenarioApi).prefetchExecution({
        context: {
          projectId,
          scenarioId: "scenario-1",
          setId: "set-1",
          batchRunId: "batch-1",
          secretParameters: { api_token: "iv:body:tag" },
        },
        target: { type: "http", referenceId: "agent-2" },
      });

      expect(prefetched).toMatchObject({
        success: false,
        error: expect.stringContaining('"api_token"'),
      });
    } finally {
      await runtime.stop();
    }
  });
});
