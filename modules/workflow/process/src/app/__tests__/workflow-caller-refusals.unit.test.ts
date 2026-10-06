import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import { WorkflowModule } from "../workflow.app.ts";

/** The app over the memory registry; a test passes the peer whose calls it watches. */
async function appWith({
  authz = createApiFixture<AuthzApi>({}, "AuthzApi"),
}: { authz?: AuthzApi } = {}): Promise<WorkflowModule> {
  return WorkflowModule.create({
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz,
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
    },
    config: {
      nlpServiceUrl: void 0,
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
      relayTurnCeilingMs: void 0,
      publicBaseUrl: void 0,
      nlpCodeBlockTimeoutSeconds: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: MemoryWorkflowRepositories.create(),
  });
}

describe("WorkflowModule caller refusals", () => {
  describe("given a Studio event posted to the editor's door", () => {
    const isAlive = JSON.stringify({
      projectId: "project_1",
      event: { type: "is_alive", payload: {} },
    });
    const authzAnswering = (granted: boolean) =>
      createApiFixture<AuthzApi>({ hasPermission: async () => granted }, "AuthzApi");
    const drain = async (events: AsyncIterable<StudioServerEvent>) => {
      const seen: StudioServerEvent[] = [];
      for await (const event of events) seen.push(event);
      return seen;
    };

    it("refuses a body that is not a Studio event as a validation error", async () => {
      await expect(
        (await appWith()).streamStudioEvent({ body: "not json", userId: "user_1" }),
      ).rejects.toMatchObject({ code: "validation_error", httpStatus: 400 });
    });

    it("refuses a caller who is not signed in", async () => {
      await expect(
        (await appWith()).streamStudioEvent({ body: isAlive, userId: undefined }),
      ).rejects.toMatchObject({ code: "unauthorized", httpStatus: 401 });
    });

    it("refuses a caller who may not manage the project's workflows", async () => {
      await expect(
        (await appWith({ authz: authzAnswering(false) })).streamStudioEvent({
          body: isAlive,
          userId: "user_1",
        }),
      ).rejects.toMatchObject({ code: "project_permission_denied", httpStatus: 403 });
    });

    it("answers a run the engine cannot start with one last error frame, then ends", async () => {
      const app = await appWith({ authz: authzAnswering(true) });

      const events = await app.streamStudioEvent({ body: isAlive, userId: "user_1" });

      expect(await drain(events)).toEqual([
        { type: "error", payload: { message: expect.stringContaining("NLP engine") } },
      ]);
    });
  });
});
