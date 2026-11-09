import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { clusterTopicsForProject, storeResults } from "../topic-clustering-runner.intent.ts";
import { fakeRunnerDeps, tracePage } from "./topic-clustering-runner.fixture.ts";

const NOW = Date.UTC(2026, 10, 3, 9, 0);
const WINDOW = { sinceMs: NOW - 86_400_000, untilMs: NOW - 3_600_000 };

function incrementalDeps() {
  const deps = fakeRunnerDeps();
  deps.traces.readTopicClusteringCounts.mockResolvedValue({
    totalTracesCount: 5_000,
    recentTracesCount: 5_000,
    assignedTracesCount: 1_500,
  });
  deps.repository.findTopicIndexRows.mockResolvedValue([
    { id: "topic_a", parentId: null, createdAt: Temporal.Instant.fromEpochMilliseconds(NOW) },
    {
      id: "subtopic_a1",
      parentId: "topic_a",
      createdAt: Temporal.Instant.fromEpochMilliseconds(NOW),
    },
  ]);
  deps.traces.readTopicClusteringPage.mockResolvedValue(tracePage(0, NOW));
  return deps;
}

describe("an incremental clustering page", () => {
  /** @scenario "A finished run moves the clustering watermark so the next run skips what it read" */
  it("reads only the traces that occurred inside the run's window", async () => {
    const deps = incrementalDeps();

    await clusterTopicsForProject(deps, { projectId: "proj-1", window: WINDOW });

    expect(deps.traces.readTopicClusteringPage).toHaveBeenCalledWith(
      expect.objectContaining({
        isIncrementalProcessing: true,
        occurredSinceMs: WINDOW.sinceMs,
        occurredBeforeMs: WINDOW.untilMs,
      }),
    );
  });

  /** @scenario "A finished run moves the clustering watermark so the next run skips what it read" */
  it("reads the whole hot tier when no run has finished yet", async () => {
    const deps = incrementalDeps();

    await clusterTopicsForProject(deps, {
      projectId: "proj-1",
      window: { sinceMs: null, untilMs: WINDOW.untilMs },
    });

    const input = deps.traces.readTopicClusteringPage.mock.calls[0]?.[0];
    expect(input).toMatchObject({ occurredBeforeMs: WINDOW.untilMs });
    expect(input).not.toHaveProperty("occurredSinceMs");
  });

  /** @scenario "A batch run still reads every trace in the hot tier" */
  it("ignores the watermark in batch mode", async () => {
    const deps = fakeRunnerDeps();
    deps.traces.readTopicClusteringPage.mockResolvedValue(tracePage(0, NOW));

    await clusterTopicsForProject(deps, { projectId: "proj-1", window: WINDOW });

    const input = deps.traces.readTopicClusteringPage.mock.calls[0]?.[0];
    expect(input).toMatchObject({ isIncrementalProcessing: false });
    expect(input).not.toHaveProperty("occurredSinceMs");
  });
});

describe("storing a clustering result", () => {
  /** @scenario "A topic assignment lands on a trace older than the summary read window" */
  it("stamps each assignment with the trace's own time", async () => {
    const deps = fakeRunnerDeps();
    const traceOccurredAt = NOW - 40 * 86_400_000;

    await storeResults({
      deps,
      projectId: "proj-1",
      isIncremental: true,
      clusteringResult: {
        topics: [],
        subtopics: [],
        traces: [{ trace_id: "trace_old", topic_id: "topic_a", subtopic_id: null }],
        cost: { amount: 0, currency: "USD" },
      },
      occurredAtMsByTraceId: { trace_old: traceOccurredAt },
    });

    expect(deps.traces.assignTopic).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace_old", occurredAt: traceOccurredAt }),
    );
  });

  /** @scenario "A topic assignment lands on a trace older than the summary read window" */
  it("falls back to now for a trace whose time is unknown", async () => {
    const deps = fakeRunnerDeps();
    const before = Date.now();

    await storeResults({
      deps,
      projectId: "proj-1",
      isIncremental: true,
      clusteringResult: {
        topics: [],
        subtopics: [],
        traces: [{ trace_id: "trace_unknown", topic_id: "topic_a", subtopic_id: null }],
        cost: { amount: 0, currency: "USD" },
      },
      occurredAtMsByTraceId: { trace_unknown: 0 },
    });

    const occurredAt = deps.traces.assignTopic.mock.calls[0]?.[0]?.occurredAt;
    expect(occurredAt).toBeGreaterThanOrEqual(before);
  });

  /** @scenario "A trace the service lists twice is assigned once" */
  it("sends one assignment per trace, keeping the subtopic a later entry adds", async () => {
    const deps = fakeRunnerDeps();

    await storeResults({
      deps,
      projectId: "proj-1",
      isIncremental: true,
      clusteringResult: {
        topics: [],
        subtopics: [],
        traces: [
          { trace_id: "trace_1", topic_id: "topic_a", subtopic_id: null },
          { trace_id: "trace_1", topic_id: "topic_a", subtopic_id: "subtopic_new" },
        ],
        cost: { amount: 0, currency: "USD" },
      },
    });

    expect(deps.traces.assignTopic).toHaveBeenCalledTimes(1);
    expect(deps.traces.assignTopic).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace_1", subtopicId: "subtopic_new" }),
    );
  });
});
