/** Spec: specs/upgrade/projection-replay-step.feature. */
import { describe, expect, it } from "vitest";

import type { MigrationStepReport } from "../migration-step.ts";
import {
  PROJECTION_REPLAY_FROM_START,
  type LaneReplayer,
  defineProjectionReplayStep,
} from "../projection-replay-step.ts";

const LANE = "directoryMembers";
const CURSOR = "2026-10-07T12:00:00Z";

/** A replayer over a log whose events all predate `CURSOR`: two batches from the start. */
function replayerOverLog(): LaneReplayer & { sinces: string[] } {
  const sinces: string[] = [];
  return {
    sinces,
    async replayLane({ lane, since, onBatchComplete }) {
      sinces.push(since);
      const fromStart = since === PROJECTION_REPLAY_FROM_START;
      if (fromStart) {
        onBatchComplete?.({ batchNum: 1, totalBatches: 2 });
        onBatchComplete?.({ batchNum: 2, totalBatches: 2 });
      }
      return {
        lane,
        kind: "fold",
        aggregatesReplayed: fromStart ? 2 : 0,
        totalEvents: fromStart ? 3 : 0,
        replayedThrough: CURSOR,
      };
    },
  };
}

/** A replayer over two tenants that completes the first, then fails or stops if told to. */
function twoTenantReplayer({ stopAfterFirst = false }: { stopAfterFirst?: boolean } = {}) {
  const calls: Parameters<LaneReplayer["replayLane"]>[0][] = [];
  const replayer: LaneReplayer = {
    async replayLane(input) {
      calls.push(input);
      const runCursor = input.resume?.replayedThrough ?? CURSOR;
      const tenants = ["tenant-1", "tenant-2"].filter(
        (tenant) => !input.resume || tenant > input.resume.afterTenant,
      );
      for (const tenantId of tenants) {
        input.signal?.throwIfAborted();
        input.onTenantComplete?.({ tenantId, replayedThrough: runCursor });
        if (stopAfterFirst) throw new Error("worker stopping");
      }
      return {
        lane: input.lane,
        kind: "fold",
        aggregatesReplayed: tenants.length,
        totalEvents: tenants.length,
        replayedThrough: runCursor,
      };
    },
  };
  return { replayer, calls };
}

function runOnce({
  replayer,
  resumeFrom,
  dryRun = false,
  signal = new AbortController().signal,
  trailingPass,
}: {
  replayer: LaneReplayer;
  resumeFrom: MigrationStepReport | null;
  dryRun?: boolean;
  signal?: AbortSignal;
  trailingPass?: boolean;
}) {
  const saved: MigrationStepReport[] = [];
  const step = defineProjectionReplayStep({
    id: "scim:replay-directory-members",
    description: "Fills the directory members lane from identity's log.",
    lane: LANE,
    replayer,
    ...(trailingPass === undefined ? {} : { trailingPass }),
  });
  const report = step.run({
    checkpoint: { resumeFrom, save: async ({ report: next }) => void saved.push(next) },
    dryRun,
    signal,
  });
  return { step, report, saved };
}

describe("defineProjectionReplayStep", () => {
  describe("when a module declares a lane's replay", () => {
    /** @scenario "A projection replay step is a background data step its module declares" */
    it("declares a background data step under the module's id", () => {
      const { step } = runOnce({ replayer: replayerOverLog(), resumeFrom: null });

      expect(step).toMatchObject({
        id: "scim:replay-directory-members",
        kind: "data",
        mode: "background",
      });
    });
  });

  describe("given a step that never ran", () => {
    /** @scenario "A first run replays the lane from the start of the log and records its cursor" */
    it("replays from the start and reports the cursor it completed through", async () => {
      const replayer = replayerOverLog();
      const { report } = runOnce({ replayer, resumeFrom: null });

      expect(await report).toMatchObject({
        lane: LANE,
        aggregatesReplayed: 2,
        replayedThrough: CURSOR,
      });
      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START]);
    });
  });

  describe("given a step that completed through a cursor", () => {
    /** @scenario "A second run resumes from the cursor it last completed through" */
    it("replays only what arrived after the cursor", async () => {
      const replayer = replayerOverLog();
      const first = await runOnce({ replayer, resumeFrom: null }).report;

      const second = await runOnce({ replayer, resumeFrom: first }).report;

      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START, CURSOR]);
      expect(second).toMatchObject({ aggregatesReplayed: 0, replayedThrough: CURSOR });
    });
  });

  describe("given a saved report for a different lane", () => {
    it("replays from the start of the log", async () => {
      const replayer = replayerOverLog();
      await runOnce({ replayer, resumeFrom: { lane: "otherLane", replayedThrough: CURSOR } })
        .report;

      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START]);
    });
  });

  describe("when a run completes its batches", () => {
    /** @scenario "Progress saves keep the last completed cursor" */
    it("saves each batch with the cursor the run started from", async () => {
      const { report, saved } = runOnce({ replayer: replayerOverLog(), resumeFrom: null });
      await report;

      expect(saved).toEqual([
        {
          lane: LANE,
          replayedThrough: PROJECTION_REPLAY_FROM_START,
          batchesDone: 1,
          totalBatches: 2,
        },
        {
          lane: LANE,
          replayedThrough: PROJECTION_REPLAY_FROM_START,
          batchesDone: 2,
          totalBatches: 2,
        },
      ]);
    });

    it("saves nothing on a dry run", async () => {
      const { report, saved } = runOnce({
        replayer: replayerOverLog(),
        resumeFrom: null,
        dryRun: true,
      });
      await report;

      expect(saved).toEqual([]);
    });
  });

  describe("when a run completes each tenant", () => {
    /** @scenario "Each completed tenant is saved with the cursor its run completes through" */
    it("saves the start cursor, the run's cursor and the tenant it completed", async () => {
      const { report, saved } = runOnce({
        replayer: twoTenantReplayer().replayer,
        resumeFrom: null,
      });

      expect(await report).toMatchObject({ lane: LANE, replayedThrough: CURSOR });
      expect(saved).toEqual([
        {
          lane: LANE,
          replayedThrough: PROJECTION_REPLAY_FROM_START,
          runReplaysThrough: CURSOR,
          lastTenantDone: "tenant-1",
        },
        {
          lane: LANE,
          replayedThrough: PROJECTION_REPLAY_FROM_START,
          runReplaysThrough: CURSOR,
          lastTenantDone: "tenant-2",
        },
      ]);
    });
  });

  describe("given a step that saved progress through its first tenant", () => {
    /** @scenario "A run resumed after an interruption skips the tenants it completed" */
    it("resumes after that tenant from the same start cursor, through the interrupted cursor", async () => {
      const interrupted = "2026-10-08T09:00:00Z";
      const { replayer, calls } = twoTenantReplayer();

      const report = await runOnce({
        replayer,
        resumeFrom: {
          lane: LANE,
          replayedThrough: PROJECTION_REPLAY_FROM_START,
          runReplaysThrough: interrupted,
          lastTenantDone: "tenant-1",
        },
      }).report;

      expect(calls[0]).toMatchObject({
        since: PROJECTION_REPLAY_FROM_START,
        resume: { replayedThrough: interrupted, afterTenant: "tenant-1" },
      });
      expect(report).toMatchObject({ aggregatesReplayed: 1, replayedThrough: interrupted });
    });
  });

  describe("when the worker stops the step mid-run", () => {
    /** @scenario "A worker stop ends the replay without finishing it" */
    it("hands the signal to the replay and keeps only the progress it completed", async () => {
      const stop = new AbortController();
      const { replayer, calls } = twoTenantReplayer({ stopAfterFirst: true });

      const { report, saved } = runOnce({ replayer, resumeFrom: null, signal: stop.signal });

      await expect(report).rejects.toThrow("worker stopping");
      expect(calls[0]?.signal).toBe(stop.signal);
      expect(saved.map((one) => one.lastTenantDone)).toEqual(["tenant-1"]);
    });

    it("returns its start cursor without replaying when already stopped", async () => {
      const stop = new AbortController();
      stop.abort();
      const { replayer, calls } = twoTenantReplayer();

      const report = await runOnce({ replayer, resumeFrom: null, signal: stop.signal }).report;

      expect(calls).toEqual([]);
      expect(report).toEqual({ lane: LANE, replayedThrough: PROJECTION_REPLAY_FROM_START });
    });
  });

  describe("given a step declared with a trailing pass", () => {
    /** @scenario "A step with a trailing pass replays again from the cursor its first pass completed through" */
    it("commits the first pass's cursor, replays from it and reports both passes", async () => {
      const replayer = replayerOverLog();

      const { report, saved } = runOnce({ replayer, resumeFrom: null, trailingPass: true });

      expect(await report).toMatchObject({
        lane: LANE,
        aggregatesReplayed: 2,
        totalEvents: 3,
        replayedThrough: CURSOR,
      });
      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START, CURSOR]);
      expect(saved.at(-1)).toEqual({ lane: LANE, replayedThrough: CURSOR });
    });

    /** @scenario "A trailing pass interrupted by a worker stop resumes from the first pass's cursor" */
    it("resumes from the first pass's cursor after a stop in the trailing pass", async () => {
      const calls: string[] = [];
      const stopping: LaneReplayer = {
        async replayLane({ lane, since }) {
          calls.push(since);
          if (calls.length === 2) throw new Error("worker stopping");
          return {
            lane,
            kind: "fold",
            aggregatesReplayed: 0,
            totalEvents: 0,
            replayedThrough: CURSOR,
          };
        },
      };
      const stopped = runOnce({ replayer: stopping, resumeFrom: null, trailingPass: true });
      await expect(stopped.report).rejects.toThrow("worker stopping");

      const replayer = replayerOverLog();
      await runOnce({ replayer, resumeFrom: stopped.saved.at(-1) ?? null, trailingPass: true })
        .report;

      expect(replayer.sinces[0]).toBe(CURSOR);
    });

    /** @scenario "A dry run or a stopped run takes no trailing pass" */
    it("replays once on a dry run", async () => {
      const replayer = replayerOverLog();

      await runOnce({ replayer, resumeFrom: null, dryRun: true, trailingPass: true }).report;

      expect(replayer.sinces).toEqual([PROJECTION_REPLAY_FROM_START]);
    });

    it("replays once when its signal aborts during the first pass", async () => {
      const stop = new AbortController();
      const sinces: string[] = [];
      const replayer: LaneReplayer = {
        async replayLane({ lane, since }) {
          sinces.push(since);
          stop.abort();
          return {
            lane,
            kind: "fold",
            aggregatesReplayed: 1,
            totalEvents: 1,
            replayedThrough: CURSOR,
          };
        },
      };

      await runOnce({ replayer, resumeFrom: null, signal: stop.signal, trailingPass: true }).report;

      expect(sinces).toEqual([PROJECTION_REPLAY_FROM_START]);
    });
  });
});
