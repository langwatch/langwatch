import type {
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
} from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import { TopicClusteringSchedulePort } from "../src/ports/topic-clustering-schedule.port";
import {
  TopicRepository,
  type TopicClusteringStatusRecord,
} from "../src/repositories/topic.repository";
import { TopicService } from "../src/services/topic.service";
import { TOPIC_CLUSTERING_STALE_RUN_MS } from "../src/topic-clustering.constants";

const NOW = 1_800_000_000_000;
const PROJECT_ID = "project-1";

function projection(
  overrides: Partial<NonNullable<TopicClusteringStatusRecord["projection"]>> = {},
): NonNullable<TopicClusteringStatusRecord["projection"]> {
  return {
    lastRequestedAt: null,
    lastRequestTrigger: null,
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
    occurredAt: NOW,
    ...overrides,
  };
}

class FakeTopicRepository extends TopicRepository {
  constructor(
    private readonly status: TopicClusteringStatusRecord["projection"] = null,
    private readonly history: TopicClusteringRunHistoryEntry[] = [],
  ) {
    super();
  }

  findAll() {
    return Promise.resolve([]);
  }

  findNamesByIds() {
    return Promise.resolve(new Map<string, string>());
  }

  findClusteringStatus() {
    return Promise.resolve({ projection: this.status });
  }

  findClusteringRunHistory() {
    return Promise.resolve(this.history);
  }
}

class FakeSchedule extends TopicClusteringSchedulePort {
  constructor(private readonly nextWakeAt: Date | null = null) {
    super();
  }

  tryGetNextWakeAt() {
    return Promise.resolve(this.nextWakeAt);
  }
}

function service(
  options: {
    status?: TopicClusteringStatusRecord["projection"];
    history?: TopicClusteringRunHistoryEntry[];
    nextWakeAt?: Date | null;
    now?: number;
  } = {},
) {
  return TopicService.create({
    repository: new FakeTopicRepository(options.status, options.history),
    schedule: new FakeSchedule(options.nextWakeAt),
    now: () => options.now ?? NOW,
  });
}

function run(overrides: Partial<TopicClusteringRunHistoryEntry> = {}) {
  return {
    runId: "run-1",
    trigger: "scheduled",
    startedAt: NOW - 60_000,
    finishedAt: NOW - 1_000,
    outcome: "completed",
    mode: "batch",
    skippedReason: null,
    errorCode: null,
    isErrorUserActionable: false,
    tracesProcessed: 2,
    topicsCount: 1,
    subtopicsCount: 0,
    pages: 1,
    ...overrides,
  } satisfies TopicClusteringRunHistoryEntry;
}

describe("TopicService clustering status parity", () => {
  it("returns the complete empty status and the next durable wake", async () => {
    const status = await service({
      nextWakeAt: new Date(NOW + 60_000),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(status).toEqual({
      lastRequestedAt: null,
      lastRequestTrigger: null,
      lastRunAt: null,
      lastRunOutcome: null,
      lastRunMode: null,
      lastRunSkippedReason: null,
      lastRunErrorCode: null,
      isLastRunErrorUserActionable: false,
      lastRunTracesProcessed: 0,
      lastRunTopicsCount: 0,
      lastRunSubtopicsCount: 0,
      isInProgress: false,
      isRunInFlight: false,
      nextRunAt: NOW + 60_000,
    } satisfies TopicClusteringStatus);
  });

  it("passes a completed run's mode, outcome, reason, error and counts through", async () => {
    const status = await service({
      status: projection({
        lastRunAt: NOW - 1_000,
        lastRunOutcome: "completed",
        lastRunMode: "incremental",
        lastRunSkippedReason: null,
        lastRunErrorCode: null,
        lastRunTracesProcessed: 120,
        lastRunTopicsCount: 8,
        lastRunSubtopicsCount: 30,
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(status).toMatchObject({
      lastRunOutcome: "completed",
      lastRunMode: "incremental",
      lastRunSkippedReason: null,
      lastRunErrorCode: null,
      lastRunTracesProcessed: 120,
      lastRunTopicsCount: 8,
      lastRunSubtopicsCount: 30,
    });
  });

  it.each([
    ["manual", true],
    ["bootstrap", false],
  ] as const)(
    "only treats an unanswered %s request as in flight",
    async (trigger, expected) => {
      const status = await service({
        status: projection({
          lastRequestedAt: NOW - 5_000,
          lastRequestTrigger: trigger,
        }),
      }).getClusteringStatus({ projectId: PROJECT_ID });

      expect(status.isRunInFlight).toBe(expected);
      expect(status.isInProgress).toBe(false);
    },
  );

  it("stops treating an unanswered request as in flight at the stale boundary", async () => {
    const status = await service({
      status: projection({
        lastRequestedAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS,
        lastRequestTrigger: "manual",
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(status.isRunInFlight).toBe(false);
  });

  it("treats an answered request as no longer in flight", async () => {
    const status = await service({
      status: projection({
        lastRequestedAt: NOW - 5_000,
        lastRequestTrigger: "manual",
        lastRunAt: NOW - 1_000,
        lastRunOutcome: "completed",
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(status.isRunInFlight).toBe(false);
  });

  it("bounds an in-progress run by its start, falling back to occurredAt", async () => {
    const live = await service({
      status: projection({
        inProgressRunId: "run-live",
        inProgressStartedAt: NOW - 1_000,
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });
    const stale = await service({
      status: projection({
        inProgressRunId: "run-stale",
        inProgressStartedAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS,
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });
    const legacy = await service({
      status: projection({
        inProgressRunId: "run-legacy",
        inProgressStartedAt: null,
        occurredAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS,
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(live.isInProgress).toBe(true);
    expect(stale.isInProgress).toBe(false);
    expect(legacy.isInProgress).toBe(false);
  });

  it("keeps raw provider error text out of the public status", async () => {
    const status = await service({
      status: projection({
        lastRunOutcome: "failed",
        lastRunErrorCode: "model_provider_auth",
        lastRunErrorUserActionable: true,
      }),
    }).getClusteringStatus({ projectId: PROJECT_ID });

    expect(status.lastRunErrorCode).toBe("model_provider_auth");
    expect(status.isLastRunErrorUserActionable).toBe(true);
    expect(Object.keys(status)).not.toContain("lastRunError");
  });
});

describe("TopicService clustering history parity", () => {
  it("preserves stored newest-first order and abandons stale running entries", async () => {
    const runs = await service({
      history: [
        run({ runId: "run-new" }),
        run({
          runId: "run-live",
          outcome: "running",
          finishedAt: null,
        }),
        run({
          runId: "run-stale",
          outcome: "running",
          finishedAt: null,
          startedAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS - 1,
        }),
      ],
    }).getClusteringRunHistory({ projectId: PROJECT_ID });

    expect(runs.map(({ runId, outcome }) => ({ runId, outcome }))).toEqual([
      { runId: "run-new", outcome: "completed" },
      { runId: "run-live", outcome: "running" },
      { runId: "run-stale", outcome: "abandoned" },
    ]);
  });
});
