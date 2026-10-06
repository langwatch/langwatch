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
import type {
  WorkflowEvaluationRequest,
  WorkflowEvaluationStarted,
} from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import { WorkflowModule } from "../workflow.app.ts";

async function appWith(experiments: ExperimentApi): Promise<WorkflowModule> {
  return WorkflowModule.create({
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments,
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

describe("WorkflowModule.triggerEvaluation", () => {
  describe("given a request naming a committed version", () => {
    /** @scenario "Evaluation remains application composition" */
    it("hands the version selection to the Experiment module's run and returns its answer unchanged", async () => {
      const started: WorkflowEvaluationStarted = {
        runId: "run_1",
        runUrl: "https://app.test/p/experiments/exp_1?runId=run_1",
        workflowVersionId: "version_9",
        version: "9",
      };
      const triggerWorkflowEvaluation = vi.fn(async () => started);
      const app = await appWith(
        createApiFixture<ExperimentApi>({ triggerWorkflowEvaluation }, "ExperimentApi"),
      );
      const request: WorkflowEvaluationRequest = {
        workflowId: "workflow_1",
        projectId: "project_1",
        projectSlug: "project-one",
        versionId: "version_9",
      };

      await expect(app.triggerEvaluation(request)).resolves.toEqual(started);
      expect(triggerWorkflowEvaluation).toHaveBeenCalledExactlyOnceWith(request);
    });
  });
});
