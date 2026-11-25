import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { topicProcessModule } from "../../topic.module.ts";
function process(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [topicProcessModule],
    config: {},
    stores: memoryStores(),
    peers: [
      testPeer({ token: DataRetentionApi, instance: createApiFixture<DataRetentionApi>({}) }),
      testPeer({ token: EvaluationApi, instance: createApiFixture<EvaluationApi>({}) }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>({}) }),
      testPeer({ token: ModelProviderApi, instance: createApiFixture<ModelProviderApi>({}) }),
    ],
  });
}

describe("topic app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role);

    try {
      const app = runtime.service(TopicApi);

      expect(runtime.module(topicProcessModule).provided).toBe(app);
      await expect(app.getAll({ projectId: "project-1" })).resolves.toEqual([]);
      await expect(
        app.getNamesByIds({ projectIds: ["project-1"], ids: ["topic-1"] }),
      ).resolves.toEqual(new Map());
      await expect(app.getClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  describe("when no clustering wake is scheduled in the memory tier", () => {
    it("reports no next run rather than reaching for a database", async () => {
      const runtime = await process("worker");

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
