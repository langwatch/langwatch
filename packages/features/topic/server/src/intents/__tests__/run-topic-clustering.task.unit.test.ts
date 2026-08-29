import { describe, expect, it, vi } from "vitest";
import { RequestTopicClusteringTask } from "../run-topic-clustering.intent";

describe("RequestTopicClusteringTask", () => {
  it("dispatches one manual request through Topic's Eventing command", async () => {
    const requestClustering = vi.fn(async () => undefined);
    const task = RequestTopicClusteringTask.create({
      commands: {
        recordTopics: vi.fn(async () => undefined),
        requestClustering,
      },
      now: () => 123,
    });

    await task.execute("project-1");

    expect(requestClustering).toHaveBeenCalledOnce();
    expect(requestClustering).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 123,
      trigger: "manual",
    });
  });
});
