import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { topicClustering } from "./aggregate";
import {
  initTopicClusteringScheduleState,
  nextDailySlot,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_STALE_RUN_MS,
  type TopicClusteringScheduleState,
  topicClusteringProcess,
} from "./process";
import { mintManualRunId, mintScheduledRunId, runRank } from "./runIdentity";

const PROJECT_ID = "project-1";

function ctx(overrides: Partial<ProcessContext> = {}): ProcessContext {
  return {
    processKey: PROJECT_ID,
    tenantId: PROJECT_ID,
    at: 1_700_000_000_000,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

const intents = topicClusteringProcess.intents;

/** Routes through the built dispatcher, so the event key → handler binding is
 * exercised rather than assumed. */
function evolve(
  state: TopicClusteringScheduleState,
  event: { type: string; data: unknown },
  overrides: Partial<ProcessContext> = {},
) {
  return topicClusteringProcess.evolve(
    state,
    event as Parameters<typeof topicClusteringProcess.evolve>[1],
    intents,
    ctx(overrides),
  );
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
      // Not a guarantee for every id pair — a hash can collide — but it shows
      // the slot is a function of the id rather than a fixed constant.
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
      const step = evolve(
        initTopicClusteringScheduleState(),
        topicClustering.events.requested({
          projectId: PROJECT_ID,
          trigger: "manual",
          occurredAt: 1_700_000_000_000,
        }),
      );
      expect(step?.state.currentRun).not.toBeNull();
      expect(step?.intents).toHaveLength(1);
      expect(step?.nextWakeAt).not.toBeNull();
    });

    /** @scenario Asking for a run while one is already working says so */
    it("does not start a second run when one is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = evolve(
        { currentRun: { runId, page: 1 } },
        topicClustering.events.requested({
          projectId: PROJECT_ID,
          trigger: "manual",
          occurredAt: 1_700_000_100_000,
        }),
        { at: 1_700_000_100_000, now: 1_700_000_100_000 },
      );
      expect(step?.state.currentRun?.runId).toBe(runId);
      expect(step?.intents).toHaveLength(0);
    });

    it("preempts a stale (abandoned) in-flight run", () => {
      const staleRunId = mintScheduledRunId(1_700_000_000_000);
      const refMs = 1_700_000_000_000 + TOPIC_CLUSTERING_STALE_RUN_MS + 1000;
      const step = evolve(
        { currentRun: { runId: staleRunId, page: 1 } },
        topicClustering.events.requested({
          projectId: PROJECT_ID,
          trigger: "manual",
          occurredAt: refMs,
        }),
        { at: refMs, now: refMs },
      );
      expect(step?.state.currentRun?.runId).not.toBe(staleRunId);
      expect(step?.intents).toHaveLength(1);
    });

    it("mints the same runId, and the same message key, for a redelivered request", () => {
      const requested = topicClustering.events.requested({
        projectId: PROJECT_ID,
        trigger: "manual",
        occurredAt: 1_700_000_000_000,
      });
      const first = evolve(initTopicClusteringScheduleState(), requested);
      const second = evolve(initTopicClusteringScheduleState(), requested);

      expect(first?.state.currentRun?.runId).toBe(
        second?.state.currentRun?.runId,
      );
      expect(first?.intents[0]?.messageKey).toBe(
        second?.intents[0]?.messageKey,
      );
    });

    it("does not start a run for a bootstrap request — it only ensures the schedule exists", () => {
      const step = evolve(
        initTopicClusteringScheduleState(),
        topicClustering.events.requested({
          projectId: PROJECT_ID,
          trigger: "bootstrap",
          occurredAt: 1_700_000_000_000,
        }),
      );
      expect(step?.state.currentRun).toBeNull();
      expect(step?.intents).toHaveLength(0);
      expect(step?.nextWakeAt).not.toBeNull();
    });
  });

  describe("given a run completes", () => {
    const completed = (
      runId: string,
      page: number,
      nextSearchAfter?: [number, string],
    ) =>
      topicClustering.events.runCompleted({
        projectId: PROJECT_ID,
        runId,
        page,
        mode: "batch",
        tracesProcessed: 1,
        topicsCount: 0,
        subtopicsCount: 0,
        occurredAt: 1_700_000_000_000,
        nextSearchAfter,
      });

    /** @scenario A large backlog is processed page by page through durable cursors */
    it("continues the walk when a continuation cursor is returned", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = evolve(
        { currentRun: { runId, page: 1 } },
        completed(runId, 1, [123, "trace-1"]),
      );
      expect(step?.state.currentRun).toEqual({ runId, page: 2 });
      expect(step?.intents).toHaveLength(1);
      expect(step?.intents[0]?.messageKey).toBe(`run:${runId}:page-2`);
    });

    it("clears the in-flight run once the final page (no cursor) completes", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = evolve(
        { currentRun: { runId, page: 2 } },
        completed(runId, 2),
      );
      expect(step?.state.currentRun).toBeNull();
    });

    /** @scenario A crash mid-backlog resumes from the last committed page */
    it("ignores a stale completion for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const step = evolve(
        { currentRun: { runId: newer, page: 1 } },
        completed(older, 2, [1, "t"]),
      );
      expect(step?.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("given a run fails", () => {
    const failed = (runId: string) =>
      topicClustering.events.runFailed({
        projectId: PROJECT_ID,
        runId,
        page: 1,
        error: "boom",
        occurredAt: 1_700_000_000_000,
      });

    /** @scenario A failing clustering effect retries then records a visible failure */
    it("clears the in-flight run", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = evolve({ currentRun: { runId, page: 1 } }, failed(runId));
      expect(step?.state.currentRun).toBeNull();
    });

    it("ignores a stale failure for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const step = evolve(
        { currentRun: { runId: newer, page: 1 } },
        failed(older),
      );
      expect(step?.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("onTopicClusteringWake", () => {
    /** @scenario Daily wake runs clustering and reschedules itself */
    it("starts a scheduled run and reschedules the next daily slot", () => {
      const step = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        intents,
        ctx(),
      );
      expect(step.state.currentRun).not.toBeNull();
      expect(step.intents).toHaveLength(1);
      expect(step.nextWakeAt).toBeGreaterThan(ctx().now);
    });

    /** @scenario A run in progress is visible while it is still working */
    it("skips the slot when a run is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const step = onTopicClusteringWake(
        { currentRun: { runId, page: 1 } },
        intents,
        ctx({ at: 1_700_000_001_000, now: 1_700_000_001_000 }),
      );
      expect(step.state.currentRun?.runId).toBe(runId);
      expect(step.intents).toHaveLength(0);
    });

    /** @scenario A stale wake stands down */
    it("clamps scheduling to the present rather than the (possibly past) wake instant", () => {
      const now = 1_700_000_000_000;
      const step = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        intents,
        ctx({ at: 1_600_000_000_000, now }),
      );
      expect(step.nextWakeAt).toBeGreaterThan(now);
    });

    it("mints a scheduled run id ranked at the clamped instant", () => {
      const step = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        intents,
        ctx(),
      );
      expect(runRank(step.state.currentRun?.runId ?? "")).toBe(ctx().now);
    });
  });

  describe("the built process definition", () => {
    it("subscribes to exactly the event types the aggregate produces", () => {
      expect([...topicClusteringProcess.eventTypes].sort()).toEqual(
        [...topicClustering.eventTypes].sort(),
      );
    });

    it("derives its intent type and message key from the intents map", () => {
      expect(
        topicClusteringProcess.intents.run({
          runId: "x",
          page: 1,
          searchAfter: null,
        }),
      ).toEqual({
        intentType: "topicClustering/run",
        messageKey: "run:x:page-1",
        payload: { runId: "x", page: 1, searchAfter: null },
      });
    });

    it("produces no step for an event it declares no handler for", () => {
      expect(
        evolve(
          initTopicClusteringScheduleState(),
          topicClustering.events.topicsRecorded({
            projectId: PROJECT_ID,
            mode: "replace",
            source: "clustering",
            dedupeKey: "seed:v1",
            topics: [],
            occurredAt: 1_700_000_000_000,
          }),
        ),
      ).toBeNull();
    });
  });

  it("mintManualRunId produces the same id the requested handler mints", () => {
    expect(mintManualRunId(42)).toBe("manual-42");
  });
});
