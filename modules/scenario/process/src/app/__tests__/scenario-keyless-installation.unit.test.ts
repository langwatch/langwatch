/**
 * @vitest-environment node
 * The scenario feature booted on a deployment that configured no encryption key.
 */
import { EventEmitter } from "node:events";

import { type AgentApi, AgentNotFoundError } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { createProcessMembers, memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  scenarioInstallationSecrets,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import { scenarioServer } from "../../scenario.server.ts";
import type { ScenarioReadOnlyClickHouse } from "../scenario.app.ts";

const projectId = "project-1";

/** The encryption member exactly as a process with no key builds it. */
function keylessEncryption() {
  return createProcessMembers({
    config: {
      processName: "scenario-keyless-test",
      encryptionKey: "",
      secrets: {},
      rateLimit: { requests: 60, seconds: 60 },
      mail: { provider: "off" },
    },
  }).read("encryption");
}

const unconfiguredEncryption = { name: "MemberNotConfiguredError", member: "encryption" };

function process(role: "api" | "worker", emitter: EventEmitter) {
  return createApp({ role, secrets: scenarioInstallationSecrets() })
    .withModules([withMemoryRepositories(scenarioServer)])
    .withConfig({ scenario: scenarioTestConfig })
    .withStores(memoryStores())
    .withAnalytical(createApiFixture<ScenarioReadOnlyClickHouse>())
    .withKeyvalue(memoryRedisDouble())
    .withMember("encryption", keylessEncryption())
    .withMember("rateLimiter", { check: async () => ({ allowed: true }) })
    .withMember("idempotency", { claim: async () => true })
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("nlpServiceUrl", undefined)
    .withMember("nlpCodeBlockTimeoutSeconds", undefined)
    .withMember("isSaas", false)
    .withMember("nodeEnvironment", "test")
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
      billing: createApiFixture<BillingApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
      suite: createApiFixture<SuiteApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      prompt: createApiFixture<PromptApi>(),
      secret: createApiFixture<SecretApi>(),
      workflow: createApiFixture<WorkflowApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      authz: createApiFixture<AuthzApi>(),
      gateway: createApiFixture<GatewayApi>(),
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
