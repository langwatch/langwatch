/**
 * The run store's phases: a stopped run is read until its numbers hold still,
 * and a run that ended long before the page opened is settled at once.
 *
 * @see specs/traces-v2/instant-eval-search.feature
 */

import type { ExplorerInstantEvalProgress } from "@langwatch/trace-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_SETTLE_GRACE_MS,
  instantEvalRunPhase,
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../instant-eval-run.store.ts";

function run(overrides: Partial<ExplorerInstantEvalProgress> = {}): ExplorerInstantEvalProgress {
  return {
    id: "run-1",
    status: "running",
    total: 100,
    progress: 10,
    matched: 3,
    failed: 0,
    skipped: 0,
    error: null,
    priceUsd: 0.01,
    finishedAtMs: null,
    ...overrides,
  };
}

describe("given a run the page is watching", () => {
  beforeEach(() => {
    useInstantEvalRunStore.setState({ runs: {}, stoppedByUser: {}, quiet: {}, settled: {} });
  });

  describe("when it is still judging", () => {
    it("is judging, and stopping once this page asked it to stop", () => {
      expect(instantEvalRunPhase({ run: run(), isStopRequested: false, isSettled: false })).toBe(
        "judging",
      );
      expect(instantEvalRunPhase({ run: run(), isStopRequested: true, isSettled: false })).toBe(
        "stopping",
      );
    });
  });

  describe("when its status has turned terminal", () => {
    it("settles only once the counters held still and the table read them", () => {
      const ended = run({ status: "finished", finishedAtMs: Date.now() });
      expect(instantEvalRunPhase({ run: ended, isStopRequested: false, isSettled: false })).toBe(
        "settling",
      );
      expect(instantEvalRunPhase({ run: ended, isStopRequested: false, isSettled: true })).toBe(
        "settled",
      );
    });

    it("marks it quiet when a second read brings the same counters", () => {
      const ended = run({ status: "finished", finishedAtMs: Date.now() });
      const store = useInstantEvalRunStore.getState();
      store.setRun(ended);
      expect(useInstantEvalRunStore.getState().quiet["run-1"]).toBeUndefined();
      useInstantEvalRunStore.getState().setRun(ended);
      expect(useInstantEvalRunStore.getState().quiet["run-1"]).toBe(true);
    });
  });

  describe("when it is read for the first time long after it ended", () => {
    it("is settled at once: a reload of a finished run waits for nothing", () => {
      const now = Date.now();
      useInstantEvalRunStore.getState().setRun(
        run({
          status: "finished",
          finishedAtMs: now - INSTANT_EVAL_SETTLE_GRACE_MS - 1,
        }),
        now,
      );

      expect(selectInstantEvalRunPhase(useInstantEvalRunStore.getState(), "run-1")).toBe("settled");
    });
  });

  describe("when the query no longer names it", () => {
    it("is dropped with everything remembered about it", () => {
      useInstantEvalRunStore.getState().setRun(run());
      useInstantEvalRunStore.getState().markStopped("run-1");
      useInstantEvalRunStore.getState().keepOnly([]);

      expect(useInstantEvalRunStore.getState().runs).toEqual({});
      expect(useInstantEvalRunStore.getState().stoppedByUser).toEqual({});
      expect(selectInstantEvalRunPhase(useInstantEvalRunStore.getState(), "run-1")).toBeNull();
    });
  });
});
