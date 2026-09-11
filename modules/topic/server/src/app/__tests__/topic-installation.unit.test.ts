import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import { topicServer } from "../../topic.server.ts";
import { topicTestWake, UnscheduledTopicClustering } from "./topic.fixture.ts";

const WAKE = 1_800_000_060_000;

/**
 * A topic process over memory repositories.
 *
 * The schedule reader a clustering wake comes from is NOT wired, and cannot be
 * from here: it is one of `TopicInfrastructure`'s own collaborators, not one of
 * the canonical process members `reads()` can name, so the only seam that can
 * carry it is a per-module one - `withModule(topicServer, { members })`, which
 * `ApplicationBuilder` does not implement yet. Until it does, a caller that
 * passes a schedule is accepted and the schedule is ignored, and the wake
 * scenario below fails in `topic.service.ts` where the reader would have been.
 * Wiring it means changing this test together with `topic.app.ts` and
 * `topic.server.ts`, which is why it is not done here.
 */
function process(input: "api" | "worker" | UnscheduledTopicClustering = "api") {
  const role = typeof input === "string" ? input : "api";

  return createApp({ role, config: {} }).withModules([withMemoryRepositories(topicServer)]);
}

describe("topic app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(TopicApi);

      expect(runtime.module(topicServer).provided).toBe(app);
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
      const runtime = await process(UnscheduledTopicClustering.create(topicTestWake(WAKE))).boot();

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
