/**
 * @vitest-environment node
 * The scenario feature, booted the way a process boots it: memory repositories and scripted peers.
 */
import { EventEmitter } from "node:events";

import { type AgentApi, AgentNotFoundError, type AgentWithFields } from "@langwatch/agent-contract";
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
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  scenarioInstallationSecrets,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import { scenarioProcessModule } from "../../scenario.module.ts";

const projectId = "project-1";

const signatureAgent: AgentWithFields = {
  id: "agent-1",
  projectId,
  name: "Signature agent",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  type: "signature",
  config: {},
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

function process(role: "api" | "worker", emitter: EventEmitter) {
  return createApp({ role, secrets: scenarioInstallationSecrets() })
    .withModules([scenarioProcessModule])
    .withConfig({
      scenario: { ...scenarioTestConfig, publicBaseUrl: "https://app.langwatch.test" },
    })
    .withStores(memoryStores())
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

describe("scenario app installation", () => {
  describe.each(["api", "worker"] as const)("given the %s role over memory", (role) => {
    /** @scenario "Every collaborator the scenario operations read is built at boot in the api and worker roles" */
    it("answers every operation its built collaborators serve", async () => {
      const emitter = new EventEmitter();
      const runtime = await process(role, emitter).boot();

      try {
        const app = runtime.service(ScenarioApi);

        await expect(
          app.testAgentTurn({ projectId, agent: signatureAgent, actor: void 0, message: "hi" }),
        ).rejects.toMatchObject({ code: "agent_test_refused" });

        await expect(
          app.prefetchExecution({
            context: { projectId, scenarioId: "scenario-1", setId: "set-1", batchRunId: "b-1" },
            target: { type: "http", referenceId: "agent-2" },
          }),
        ).resolves.toMatchObject({ success: false });

        await app.startTabPresence({ projectId, tabKey: "tab-key", tabId: "tab-1" });
        await expect(
          app.offerScenarioBrowserTab({
            projectId,
            projectSlug: "project-one",
            tabKey: "tab-key",
            batchRunId: "batch-1",
          }),
        ).resolves.toMatchObject({ delivered: true });

        const controller = new AbortController();
        const updates = app
          .simulationUpdates({ projectId, signal: controller.signal })
          [Symbol.asyncIterator]();
        const next = updates.next();
        emitter.emit("simulation_updated", { event: "{}", timestamp: 1 });
        await expect(next).resolves.toEqual({
          value: { event: "{}", timestamp: 1 },
          done: false,
        });
        controller.abort();
        await expect(updates.next()).rejects.toMatchObject({ name: "AbortError" });

        // The memory tier refuses Results reads as main refused a deployment without ClickHouse.
        await expect(
          app.getResultsOverview({ filter: { projectId, startDate: 0 }, groupBy: "scenario" }),
        ).rejects.not.toBeInstanceOf(TypeError);
        await expect(app.getRunConfigurations({ projectId })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
