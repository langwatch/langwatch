import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { topicProcessModule } from "../../topic.module.ts";
function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([topicProcessModule])
    .withStores(memoryStores())
    .provide({
      evaluation: createApiFixture<EvaluationApi>({}),
      trace: createApiFixture<TraceApi>({}),
      "model-provider": createApiFixture<ModelProviderApi>({}),
    });
}

describe("topic app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(TopicApi);

      expect(runtime.module(topicProcessModule).provided).toBe(app);
      await expect(app.getAll({ projectId: "project-1" })).resolves.toEqual([]);
      await expect(
        app.getNamesByIds({ projectId: "project-1", ids: ["topic-1"] }),
      ).resolves.toEqual(new Map());
      await expect(app.getClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  describe("when no clustering wake is scheduled in the memory tier", () => {
    it("reports no next run rather than reaching for a database", async () => {
      const runtime = await process("worker").boot();

      try {
        const status = await runtime.service(TopicApi).getClusteringStatus({
          projectId: "project-1",
        });

        expect(status.nextRunAt).toBeNull();
        expect(status.isInProgress).toBe(false);
        expect(status.isRunInFlight).toBe(false);
      } finally {
        await runtime.stop();
      }
    });
  });
});
