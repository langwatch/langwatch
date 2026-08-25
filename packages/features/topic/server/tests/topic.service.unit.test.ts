import type { TopicClusteringRunHistoryEntry, Topic } from "@langwatch/topic-contract";
import { TopicService } from "../src/services/topic.service";
import {
  TopicRepository,
  type TopicClusteringStatusRecord,
} from "../src/repositories/topic.repository";
import { describe, expect, it } from "vitest";
import { TopicClusteringSchedulePort } from "../src/ports/topic-clustering-schedule.port";

class FakeTopicRepository extends TopicRepository {
  async findAll(): Promise<Topic[]> {
    return [
      {
        id: "topic-1",
        name: "Payments",
        parentId: null,
        automaticallyGenerated: true,
      },
    ];
  }

  async findNamesByIds(): Promise<Map<string, string>> {
    return new Map([["topic-1", "Payments"]]);
  }

  async findClusteringStatus(): Promise<TopicClusteringStatusRecord> {
    return {
      projection: {
        lastRequestedAt: 100,
        lastRequestTrigger: "manual",
        lastRunAt: null,
        lastRunOutcome: null,
        lastRunMode: null,
        lastRunSkippedReason: null,
        lastRunErrorCode: null,
        lastRunErrorUserActionable: false,
        lastRunTracesProcessed: 0,
        lastRunTopicsCount: 0,
        lastRunSubtopicsCount: 0,
        inProgressRunId: null,
        inProgressStartedAt: null,
        occurredAt: 100,
      },
    };
  }

  async findClusteringRunHistory(): Promise<TopicClusteringRunHistoryEntry[]> {
    return [
      {
        runId: "run-1",
        trigger: "manual",
        startedAt: 1,
        finishedAt: 2,
        outcome: "completed",
        mode: "batch",
        skippedReason: null,
        errorCode: null,
        isErrorUserActionable: false,
        tracesProcessed: 1,
        topicsCount: 1,
        subtopicsCount: 0,
        pages: 1,
      },
    ];
  }
}

class FakeTopicSchedule extends TopicClusteringSchedulePort {
  tryGetNextWakeAt(): Promise<Date | null> {
    return Promise.resolve(new Date(200));
  }
}

describe("TopicService", () => {
  const service = TopicService.create({
    repository: new FakeTopicRepository(),
    schedule: new FakeTopicSchedule(),
    now: () => 150,
  });

  it("validates inputs and exposes the projected topic read surface", async () => {
    await expect(service.getAll({ projectId: "project-1" })).resolves.toHaveLength(1);
    await expect(
      service.getNamesByIds({ projectId: "project-1", ids: ["topic-1"] }),
    ).resolves.toEqual(new Map([["topic-1", "Payments"]]));
    expect(() => service.getAll({ projectId: "" })).toThrow();
  });

  it("derives in-flight status and preserves bounded history", async () => {
    const status = await service.getClusteringStatus({ projectId: "project-1" });
    expect(status.isRunInFlight).toBe(true);
    expect(status.nextRunAt).toBe(200);
    await expect(
      service.getClusteringRunHistory({ projectId: "project-1" }),
    ).resolves.toEqual([
      expect.objectContaining({ runId: "run-1", outcome: "completed" }),
    ]);
  });
});
