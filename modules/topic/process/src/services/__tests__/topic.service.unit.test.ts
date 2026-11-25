import { Temporal, type Instant } from "@langwatch/time";
import type { TopicClusteringRunHistoryEntry, Topic } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import type { TopicClusteringScheduleReader } from "../../app/topic.app.ts";
import type {
  TopicClusteringStatusRecord,
  TopicRepository,
} from "../../repositories/topic.repository.ts";
import { TopicService } from "../topic.service.ts";

class FakeTopicRepository implements TopicRepository {
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

class FakeTopicSchedule implements TopicClusteringScheduleReader {
  findNextWakeAt(): Promise<Instant | null> {
    return Promise.resolve(Temporal.Instant.fromEpochMilliseconds(200));
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
      service.getNamesByIds({ projectIds: ["project-1"], ids: ["topic-1"] }),
    ).resolves.toEqual(new Map([["topic-1", "Payments"]]));
    expect(() => service.getAll({ projectId: "" })).toThrow(ZodError);
  });

  /** @scenario "read clustering status and history" */
  it("derives in-flight status and preserves bounded history", async () => {
    const status = await service.getClusteringStatus({ projectId: "project-1" });
    expect(status.isRunInFlight).toBe(true);
    expect(status.nextRunAt).toBe(200);
    await expect(service.getClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual([
      expect.objectContaining({ runId: "run-1", outcome: "completed" }),
    ]);
  });
});

function runOf(runId: string, overrides: Partial<TopicClusteringRunHistoryEntry> = {}) {
  return {
    runId,
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
    ...overrides,
  } satisfies TopicClusteringRunHistoryEntry;
}

class RetainedHistoryRepository extends FakeTopicRepository {
  constructor(public runs: TopicClusteringRunHistoryEntry[]) {
    super();
  }

  override async findClusteringRunHistory(): Promise<TopicClusteringRunHistoryEntry[]> {
    return this.runs;
  }
}

describe("TopicService run history by page", () => {
  const PROJECT = "project-1";
  const retained = ["run-6", "run-5", "run-4", "run-3", "run-2", "run-1", "run-0"].map((id) =>
    runOf(id),
  );

  function serviceOver(repository: RetainedHistoryRepository, now = 150) {
    return TopicService.create({
      repository,
      schedule: new FakeTopicSchedule(),
      now: () => now,
    });
  }

  async function walk(service: TopicService, limit: number) {
    const pages: { ids: string[]; hasMore: boolean; nextCursor: string | null }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await service.getClusteringRunHistoryPage({ projectId: PROJECT, cursor, limit });
      if (page.outcome !== "page") throw new Error("the walk expired");
      pages.push({
        ids: page.entries.map((entry) => entry.runId),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      if (!page.hasMore) return pages;
      cursor = page.nextCursor ?? void 0;
    }
  }

  /** @scenario "The run history continues page by page, newest first, to its retained end" */
  it("lists every retained run exactly once, in order, and only the last page ends", async () => {
    const service = serviceOver(new RetainedHistoryRepository(retained));

    const pages = await walk(service, 3);

    expect(pages).toEqual([
      { ids: ["run-6", "run-5", "run-4"], hasMore: true, nextCursor: "run-4" },
      { ids: ["run-3", "run-2", "run-1"], hasMore: true, nextCursor: "run-1" },
      { ids: ["run-0"], hasMore: false, nextCursor: null },
    ]);
    await expect(service.getClusteringRunHistory({ projectId: PROJECT })).resolves.toEqual(
      retained,
    );
  });

  /** @scenario "The run history continues page by page, newest first, to its retained end" */
  it("ends with no more when the last page is exactly full", async () => {
    const service = serviceOver(new RetainedHistoryRepository(retained.slice(0, 4)));

    expect(await walk(service, 2)).toEqual([
      { ids: ["run-6", "run-5"], hasMore: true, nextCursor: "run-5" },
      { ids: ["run-4", "run-3"], hasMore: false, nextCursor: null },
    ]);
  });

  /** @scenario "A project with no recorded runs has an empty single page" */
  it("answers an empty last page when no run was recorded", async () => {
    const service = serviceOver(new RetainedHistoryRepository([]));

    await expect(
      service.getClusteringRunHistoryPage({ projectId: PROJECT, limit: 20 }),
    ).resolves.toEqual({
      outcome: "page",
      entries: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  /** @scenario "A run finishing between two pages does not repeat or skip a run" */
  it("continues after the last run the reader saw when a newer run joined", async () => {
    const repository = new RetainedHistoryRepository(retained);
    const service = serviceOver(repository);
    const first = await service.getClusteringRunHistoryPage({ projectId: PROJECT, limit: 3 });
    if (first.outcome !== "page") throw new Error("expected a page");

    repository.runs = [runOf("run-7"), ...retained];
    const second = await service.getClusteringRunHistoryPage({
      projectId: PROJECT,
      cursor: first.nextCursor ?? void 0,
      limit: 3,
    });

    expect(second).toMatchObject({
      outcome: "page",
      entries: [{ runId: "run-3" }, { runId: "run-2" }, { runId: "run-1" }],
    });
  });

  /** @scenario "A cursor whose run has left the retained history asks the reader to restart" */
  it.each([
    ["trimmed away by the projection", "run-9"],
    ["from another project's history", "run-of-another-project"],
  ])("answers cursor_expired for a cursor %s and carries no runs", async (_name, cursor) => {
    const service = serviceOver(new RetainedHistoryRepository(retained));

    await expect(
      service.getClusteringRunHistoryPage({ projectId: PROJECT, cursor, limit: 3 }),
    ).resolves.toEqual({ outcome: "cursor_expired" });
  });

  /** @scenario "A run that never finished reads as abandoned on every page" */
  it("shows a stale running run as abandoned, as the whole read does", async () => {
    const stale = runOf("run-old", { outcome: "running", finishedAt: null, startedAt: 0 });
    const service = serviceOver(
      new RetainedHistoryRepository([runOf("run-new"), stale]),
      100_000_000,
    );

    const page = await service.getClusteringRunHistoryPage({
      projectId: PROJECT,
      cursor: "run-new",
      limit: 20,
    });

    expect(page).toMatchObject({
      outcome: "page",
      entries: [{ runId: "run-old", outcome: "abandoned" }],
    });
  });

  it("refuses a malformed request before the repository is read", async () => {
    const service = serviceOver(new RetainedHistoryRepository(retained));

    await expect(
      service.getClusteringRunHistoryPage({ projectId: PROJECT, cursor: "", limit: 3 }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      service.getClusteringRunHistoryPage({ projectId: PROJECT, limit: 51 }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
