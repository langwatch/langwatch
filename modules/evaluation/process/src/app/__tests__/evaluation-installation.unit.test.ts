import { createApiFixture } from "@langwatch/api-fixture";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
/**
 * @vitest-environment node
 * The feature boots as a whole: the installer, its repositories and the one app
 * behind the `EvaluationApi` token, in every role a process installs it in.
 */
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { EVALUATION_TEST_CONFIG } from "./evaluation.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(evaluationServer)])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .provide({
      workflow: createApiFixture<WorkflowApi>(),
      trace: createApiFixture<TraceApi>(),
      "model-provider": createApiFixture<ModelProviderApi>({
        getExecutionProviders: async () => ({}),
      }),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    });
}

describe("given a process that installs the evaluation feature", () => {
  describe("when it boots", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(EvaluationApi);

        expect(runtime.module(evaluationServer).provided).toBe(app);
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
