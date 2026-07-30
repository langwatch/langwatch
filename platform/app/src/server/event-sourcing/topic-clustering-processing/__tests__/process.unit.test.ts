import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  initTopicClusteringScheduleState,
  nextDailySlot,
  onClusteringRequested,
  onClusteringRunCompleted,
  onClusteringRunFailed,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_STALE_RUN_MS,
  type TopicClusteringScheduleState,
  topicClusteringRunMessageKey,
} from "../process";
import { mintManualRunId, mintScheduledRunId, runRank } from "../runIdentity";

const PROJECT_ID = "project-1";

function ctx(overrides: Partial<ProcessContext> = {}): ProcessContext {
  return {
    processKey: PROJECT_ID,
    tenantId: PROJECT_ID,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

/** A project whose schedule has already been bootstrapped by an earlier event. */
function running(
  currentRun: TopicClusteringScheduleState["currentRun"],
): TopicClusteringScheduleState {
  return { enabled: true, currentRun };
}

describe("topicClustering process manager", () => {
  describe("nextDailySlot", () => {
    /** @scenario Each project keeps a stable daily slot spread across the fleet */
    it("is stable for the same project from one day to the next", () => {
      const day1 = nextDailySlot(PROJECT_ID, Date.UTC(2026, 6, 17, 0, 0, 0));
      const day2 = nextDailySlot(PROJECT_ID, day1 + 1000);
      expect(new Date(day2).getUTCHours()).toBe(new Date(day1).getUTCHours());
      expect(new Date(day2).getUTCMinutes()).toBe(
        new Date(day1).getUTCMinutes(),
      );
      expect(day2 - day1).toBe(24 * 60 * 60 * 1000);
    });

    it("differs between two different projects (spread across the fleet)", () => {
      expect(nextDailySlot("project-a", Date.UTC(2026, 6, 17))).not.toBe(
        nextDailySlot("project-b", Date.UTC(2026, 6, 17)),
      );
    });

    it("always returns an instant strictly after the reference", () => {
      const ref = Date.UTC(2026, 6, 17, 12, 0, 0);
      expect(nextDailySlot(PROJECT_ID, ref)).toBeGreaterThan(ref);
    });
  });

  describe("given a manual request", () => {
    /** @scenario Manual trigger runs immediately and surfaces a gate skip */
    it("starts a run immediately and reschedules the daily slot", () => {
      const step = onClusteringRequested(
        initTopicClusteringScheduleState(),
        {
          projectId: PROJECT_ID,
          trigger: "manual",
          occurredAt: 1_700_000_000_000,
        },
        ctx(),
      );
      expect(step.state.currentRun).not.toBeNull();
      expect(step.intents).toHaveLength(1);
      expect(step.nextWakeAt).not.toBeNull();
    });

    /** @scenario Asking for a run while one is already working says so */
    it("does not start a second run when one is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onClusteringRequested(
        running({ runId, page: 1 }),
        {
          projectId: PROJECT_ID,
          trigger: "manual",
          occurredAt: 1_700_000_100_000,
        },
        ctx({ now: 1_700_000_100_000 }),
      );
      expect(step.state.currentRun?.runId).toBe(runId);
      expect(step.intents).toHaveLength(0);
    });

    it("preempts a stale (abandoned) in-flight run", () => {
      const staleRunId = mintScheduledRunId(1_700_000_000_000);
      const refMs = 1_700_000_000_000 + TOPIC_CLUSTERING_STALE_RUN_MS + 1000;
      const step = onClusteringRequested(
        running({ runId: staleRunId, page: 1 }),
        { projectId: PROJECT_ID, trigger: "manual", occurredAt: refMs },
        ctx({ now: refMs }),
      );
      expect(step.state.currentRun?.runId).not.toBe(staleRunId);
      expect(step.intents).toHaveLength(1);
    });

    it("mints the same runId, and the same message key, for a redelivered request", () => {
      const data = {
        projectId: PROJECT_ID,
        trigger: "manual" as const,
        occurredAt: 1_700_000_000_000,
      };
      const first = onClusteringRequested(
        initTopicClusteringScheduleState(),
        data,
        ctx(),
      );
      const second = onClusteringRequested(
        initTopicClusteringScheduleState(),
        data,
        ctx(),
      );

      expect(first.state.currentRun?.runId).toBe(
        second.state.currentRun?.runId,
      );
    });

    it("does not start a run for a bootstrap request — it only ensures the schedule exists", () => {
      const step = onClusteringRequested(
        initTopicClusteringScheduleState(),
        {
          projectId: PROJECT_ID,
          trigger: "bootstrap",
          occurredAt: 1_700_000_000_000,
        },
        ctx(),
      );
      expect(step.state.currentRun).toBeNull();
      expect(step.intents).toHaveLength(0);
      expect(step.nextWakeAt).not.toBeNull();
    });
  });

  describe("given a run completes", () => {
    const completed = (
      runId: string,
      page: number,
      nextSearchAfter?: [number, string],
    ) => ({
      projectId: PROJECT_ID,
      runId,
      page,
      mode: "batch" as const,
      tracesProcessed: 1,
      topicsCount: 0,
      subtopicsCount: 0,
      occurredAt: 1_700_000_000_000,
      nextSearchAfter,
    });

    /** @scenario A large backlog is processed page by page through durable cursors */
    it("continues the walk when a continuation cursor is returned", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onClusteringRunCompleted(
        running({ runId, page: 1 }),
        completed(runId, 1, [123, "trace-1"]),
        ctx(),
      );
      expect(step.state.currentRun).toEqual({ runId, page: 2 });
      expect(step.intents).toHaveLength(1);
      expect(step.intents[0]).toMatchObject({
        type: "run",
        payload: { runId, page: 2 },
      });
    });

    it("clears the in-flight run once the final page (no cursor) completes", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onClusteringRunCompleted(
        running({ runId, page: 2 }),
        completed(runId, 2),
        ctx(),
      );
      expect(step.state.currentRun).toBeNull();
    });

    /** @scenario A crash mid-backlog resumes from the last committed page */
    it("ignores a stale completion for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const step = onClusteringRunCompleted(
        running({ runId: newer, page: 1 }),
        completed(older, 2, [1, "t"]),
        ctx(),
      );
      expect(step.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("given a run fails", () => {
    const failed = (runId: string) => ({
      projectId: PROJECT_ID,
      runId,
      page: 1,
      error: "boom",
      occurredAt: 1_700_000_000_000,
    });

    /** @scenario A failing clustering effect retries then records a visible failure */
    it("clears the in-flight run", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onClusteringRunFailed(
        running({ runId, page: 1 }),
        failed(runId),
        ctx(),
      );
      expect(step.state.currentRun).toBeNull();
    });

    it("ignores a stale failure for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const step = onClusteringRunFailed(
        running({ runId: newer, page: 1 }),
        failed(older),
        ctx(),
      );
      expect(step.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("given a completion for a run that has already finished", () => {
    it("does not resurrect it, so the day's scheduled slot still runs", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onClusteringRunCompleted(
        running(null),
        {
          projectId: PROJECT_ID,
          runId,
          page: 1,
          mode: "batch",
          tracesProcessed: 1,
          topicsCount: 0,
          subtopicsCount: 0,
          occurredAt: 1_700_000_000_000,
          nextSearchAfter: [123, "trace-1"],
        },
        ctx(),
      );

      expect(step.state.currentRun).toBeNull();
      expect(step.intents).toHaveLength(0);
    });
  });

  describe("onTopicClusteringWake", () => {
    /** @scenario Daily wake runs clustering and reschedules itself */
    it("starts a scheduled run and reschedules the next daily slot", () => {
      const step = onTopicClusteringWake(running(null), ctx());
      expect(step.state.currentRun).not.toBeNull();
      expect(step.intents).toHaveLength(1);
      expect(step.nextWakeAt).toBeGreaterThan(ctx().now);
    });

    /** @scenario A run in progress is visible while it is still working */
    it("skips the slot when a run is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onTopicClusteringWake(
        running({ runId, page: 1 }),
        ctx({ now: 1_700_000_001_000 }),
      );
      expect(step.state.currentRun?.runId).toBe(runId);
      expect(step.intents).toHaveLength(0);
    });

    it("mints a scheduled run id ranked at the wake's own instant", () => {
      const step = onTopicClusteringWake(running(null), ctx());
      expect(runRank(step.state.currentRun?.runId ?? "")).toBe(ctx().now);
    });

    describe("when the project was never bootstrapped", () => {
      it("starts no run and disarms itself instead of clustering every day", () => {
        const step = onTopicClusteringWake(
          initTopicClusteringScheduleState(),
          ctx(),
        );

        expect(step.state.currentRun).toBeNull();
        expect(step.intents).toHaveLength(0);
        expect(step.nextWakeAt).toBeNull();
      });
    });
  });

  describe("the run intent's message key", () => {
    /** @scenario Duplicate event delivery cannot double-run a slot */
    it("names the run and its page, so a retry computes the identical key", () => {
      const payload = { runId: "x", page: 1, searchAfter: null };
      expect(topicClusteringRunMessageKey(payload)).toBe("run:x:page-1");
      expect(topicClusteringRunMessageKey({ ...payload })).toBe(
        topicClusteringRunMessageKey(payload),
      );
    });
  });

  it("mintManualRunId produces the same id the requested handler mints", () => {
    expect(mintManualRunId(42)).toBe("manual-42");
  });
});
