/**
 * @vitest-environment node
 * The scenario feature, booted the way a process boots it: memory repositories and scripted peers.
 */
import { EventEmitter } from "node:events";

import {
  AgentApi,
  AgentNotFoundError,
  type AgentOverview,
  type AgentWithFields,
} from "@langwatch/agent-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
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

const signatureOverview: AgentOverview = {
  ...signatureAgent,
  environment: null,
  ownerUserId: null,
  hostLabel: null,
  lastSeenAt: null,
  parameters: [],
  owner: null,
  status: "offline",
  instances: [],
  selectable: true,
  notSelectableReason: null,
};

function process(role: "api" | "worker", emitter: EventEmitter) {
  return bootInstalledProcess({
    role,
    modules: [scenarioProcessModule],
    config: {
      scenario: { ...scenarioTestConfig, publicBaseUrl: "https://app.langwatch.test" },
    },
    stores: memoryStores(),
    secrets: scenarioInstallationSecrets(),
    peers: [
      testPeer({
        token: AgentApi,
        instance: createApiFixture<AgentApi>({
          getById: async ({ id }) => {
            if (id === signatureAgent.id) return signatureOverview;
            throw new AgentNotFoundError(id, projectId);
          },
        }),
      }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({
        token: ProjectApi,
        instance: createApiFixture<ProjectApi>({
          findById: async () => null,
          getOrganizationId: async () => "organization-1",
        }),
      }),
      testPeer({
        token: EntitlementApi,
        instance: createApiFixture<EntitlementApi>({ assertWithinUsageLimit: async () => {} }),
      }),
      testPeer({ token: ModelProviderApi, instance: createApiFixture<ModelProviderApi>() }),
      testPeer({
        token: PresenceApi,
        instance: createApiFixture<PresenceApi>({
          getTenantEmitter: () => emitter,
          cleanupTenantEmitter: () => {},
        }),
      }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
      testPeer({ token: DataRetentionApi, instance: createApiFixture<DataRetentionApi>() }),
      testPeer({ token: EvaluatorApi, instance: createApiFixture<EvaluatorApi>() }),
      testPeer({ token: EvaluationApi, instance: createApiFixture<EvaluationApi>() }),
      testPeer({ token: PromptApi, instance: createApiFixture<PromptApi>() }),
      testPeer({ token: SecretApi, instance: createApiFixture<SecretApi>() }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>() }),
      testPeer({
        token: FeatureFlagApi,
        instance: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      }),
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: GatewayApi, instance: createApiFixture<GatewayApi>() }),
      testPeer({ token: ApiKeyApi, instance: createApiFixture<ApiKeyApi>() }),
    ],
  });
}

describe("scenario app installation", () => {
  describe.each(["api", "worker"] as const)("given the %s role over memory", (role) => {
    /** @scenario "Every collaborator the scenario operations read is built at boot in the api and worker roles" */
    it("answers every operation its built collaborators serve", async () => {
      const emitter = new EventEmitter();
      const runtime = await process(role, emitter);

      try {
        const app = runtime.service(ScenarioApi);

        await expect(
          app.testAgentTurn({
            projectId,
            agentId: signatureAgent.id,
            actor: void 0,
            message: "hi",
          }),
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

        // The memory tier answers Results reads from its run fold, empty before any run.
        await expect(
          app.getResultsOverview({ filter: { projectId, startDate: 0 }, groupBy: "scenario" }),
        ).resolves.toMatchObject({ groups: [] });
        await expect(app.getRunConfigurations({ projectId })).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
