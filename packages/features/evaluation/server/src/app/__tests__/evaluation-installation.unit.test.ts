/**
 * @vitest-environment node
 * The feature boots as a whole: the installer, its repositories and the one app
 * behind the `EvaluationApi` token, in every role a process installs it in.
 */
import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ModelProviderApi as ModelProviderApiToken } from "@langwatch/model-provider-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { createEvaluationTestInfrastructure } from "./evaluation.fixture.ts";

function process() {
  return createApp({ name: "evaluation-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure(createEvaluationTestInfrastructure())
    .withProvided(WorkflowApi, createApiFixture<WorkflowApi>())
    .withProvided(TraceApi, createApiFixture<TraceApi>())
    .withProvided(
      ModelProviderApiToken,
      createApiFixture<ModelProviderApi>({ getExecutionProviders: async () => ({}) }),
    )
    .withFeature(evaluationServer);
}

describe("given a process that installs the evaluation feature", () => {
  describe("when it boots", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process().boot({ role });

      try {
        const app = runtime.service(EvaluationApi);

        expect(runtime.feature(evaluationServer).provided).toBe(app);
        await expect(app.listCustomEvaluators({ projectId: "project-1" })).resolves.toEqual([]);
        await expect(app.warmupEvaluators({ projectId: "project-1", count: 1 })).resolves.toEqual({
          success: true,
          count: 1,
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
