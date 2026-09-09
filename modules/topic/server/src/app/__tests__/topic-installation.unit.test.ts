import { createApp } from "@langwatch/runtime-composition";
import { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import { topicServer } from "../../topic.server.ts";
import { topicTestWake, UnscheduledTopicClustering } from "./topic.fixture.ts";

const WAKE = 1_800_000_060_000;

function process(schedule = UnscheduledTopicClustering.create()) {
  return createApp({ name: "topic-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withFeature(topicServer, { infrastructure: { schedule } });
}

describe("topic app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(TopicApi);

      expect(runtime.feature(topicServer).provided).toBe(app);
      await expect(app.getAll({ projectId: "project-1" })).resolves.toEqual([]);
      await expect(
        app.getNamesByIds({ projectId: "project-1", ids: ["topic-1"] }),
      ).resolves.toEqual(new Map());
      await expect(app.getClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  describe("when the process schedules a clustering wake", () => {
    it("reports it as the next run", async () => {
      const runtime = await process(UnscheduledTopicClustering.create(topicTestWake(WAKE))).boot({
        role: "api",
      });

      try {
        const status = await runtime.service(TopicApi).getClusteringStatus({
          projectId: "project-1",
        });

        expect(status.nextRunAt).toBe(WAKE);
        expect(status.isInProgress).toBe(false);
        expect(status.isRunInFlight).toBe(false);
      } finally {
        await runtime.stop();
      }
    });
  });
});
