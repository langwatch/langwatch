/** Spec: packages/upgrade/specs/projection-replay-since.feature. */
import { describe, expect, it } from "vitest";

import type { MigrationStepReport } from "../migration-step.ts";
import {
  PROJECTION_REPLAY_FROM_START,
  type LaneReplayer,
  defineProjectionReplayStep,
} from "../projection-replay-step.ts";

const LANE = "analytics.traceAnalytics";
const CUT_OVER = "2026-10-06T00:00:00Z";
const COMPLETED = "2026-10-07T12:00:00Z";

/** A replayer that runs two batches on any first run and reports `COMPLETED`. */
function recordingReplayer(): LaneReplayer & { sinces: string[] } {
  const sinces: string[] = [];
  return {
    sinces,
    async replayLane({ lane, since, onBatchComplete }) {
      sinces.push(since);
      const resumed = since === COMPLETED;
      if (!resumed) {
        onBatchComplete?.({ batchNum: 1, totalBatches: 2 });
        onBatchComplete?.({ batchNum: 2, totalBatches: 2 });
      }
      return {
        lane,
        kind: "fold",
        aggregatesReplayed: resumed ? 0 : 2,
        totalEvents: resumed ? 0 : 5,
        replayedThrough: COMPLETED,
      };
    },
  };
}

function runOnce({
  replayer,
  resumeFrom,
  since,
}: {
  replayer: LaneReplayer;
  resumeFrom: MigrationStepReport | null;
  since?: string;
}) {
  const saved: MigrationStepReport[] = [];
  const step = defineProjectionReplayStep({
    id: "analytics:refold-trace-analytics-overlap",
    description: "Refolds the trace analytics lane over the deploy overlap.",
    lane: LANE,
    replayer,
    needsOldWritersGone: true,
    ...(since === undefined ? {} : { since }),
  });
  const report = step.run({
    checkpoint: { resumeFrom, save: async ({ report: next }) => void saved.push(next) },
    dryRun: false,
    signal: new AbortController().signal,
  });
  return { step, report, saved };
}

describe("defineProjectionReplayStep with a since instant", () => {
  describe("given a bounded step that never ran", () => {
    /** @scenario "A first run with a since instant replays the lane from that instant" */
    it("replays from the since instant and reports the cursor it completed through", async () => {
      const replayer = recordingReplayer();
      const { report, step } = runOnce({ replayer, resumeFrom: null, since: CUT_OVER });

      expect(await report).toMatchObject({ lane: LANE, replayedThrough: COMPLETED });
      expect(replayer.sinces).toEqual([CUT_OVER]);
      expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
    });
  });

  describe("given a step declared without a since instant", () => {
    /** @scenario "A step declared without a since instant still replays from the start of the log" */
    it("replays from the start of the log", async () => {
      const replayer = recordingReplayer();
      await runOnce({ replayer, resumeFrom: null }).report;

      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START]);
    });
  });

  describe("given a bounded step that completed through a cursor", () => {
    /** @scenario "A resumed run with a since instant starts from the cursor it last completed through" */
    it("replays only from that cursor, not from the since instant", async () => {
      const replayer = recordingReplayer();
      const first = await runOnce({ replayer, resumeFrom: null, since: CUT_OVER }).report;

      const second = await runOnce({ replayer, resumeFrom: first, since: CUT_OVER }).report;

      expect(replayer.sinces).toEqual([CUT_OVER, COMPLETED]);
      expect(second).toMatchObject({ aggregatesReplayed: 0, replayedThrough: COMPLETED });
    });
  });

  describe("given a saved report for a different lane", () => {
    it("replays from the since instant", async () => {
      const replayer = recordingReplayer();
      await runOnce({
        replayer,
        resumeFrom: { lane: "otherLane", replayedThrough: COMPLETED },
        since: CUT_OVER,
      }).report;

      expect(replayer.sinces).toEqual([CUT_OVER]);
    });
  });

  describe("when a bounded run completes its batches", () => {
    /** @scenario "Progress saves of a bounded run keep the since instant until the run completes" */
    it("saves each batch with the since instant as its cursor", async () => {
      const { report, saved } = runOnce({
        replayer: recordingReplayer(),
        resumeFrom: null,
        since: CUT_OVER,
      });
      await report;

      expect(saved).toEqual([
        { lane: LANE, replayedThrough: CUT_OVER, done: 1, total: 2 },
        { lane: LANE, replayedThrough: CUT_OVER, done: 2, total: 2 },
      ]);
    });
  });
});
