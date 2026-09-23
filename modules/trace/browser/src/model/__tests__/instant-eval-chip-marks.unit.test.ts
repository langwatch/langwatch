/**
 * An `eval` chip's mark and its sweep, read off the run behind it.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import {
  instantEvalChipLabel,
  instantEvalChipMark,
  instantEvalChipMarks,
  isInstantEvalBusy,
} from "../instant-eval-chip-marks.ts";

describe("given a chip with no run under its key", () => {
  describe("when the chip is marked", () => {
    /** @scenario "A chip with no registered run is pending" */
    it("reads pending", () => {
      expect(instantEvalChipMark({ run: undefined, hasRun: false })).toBe("(pending)");
    });
  });
});

describe("given an eval chip in the search bar", () => {
  const chips = [{ runId: "run-1" }];
  const idle = { isEstimating: false, isStarting: false };

  describe("when its run is estimated, started, queued, planned or judged", () => {
    /** @scenario "An eval chip sweeps while its run is under way" */
    it("reports the chip busy", () => {
      expect(isInstantEvalBusy({ ...idle, isEstimating: true, chips: [], runs: {} })).toBe(true);
      expect(isInstantEvalBusy({ ...idle, isStarting: true, chips: [], runs: {} })).toBe(true);
      for (const status of ["queued", "planning", "running"] as const) {
        expect(isInstantEvalBusy({ ...idle, chips, runs: { "run-1": { status } } })).toBe(true);
      }
    });
  });

  describe("when its run has finished, stopped or failed", () => {
    /** @scenario "An eval chip sweeps while its run is under way" */
    it("lets the chip rest", () => {
      for (const status of ["finished", "cancelled", "failed"] as const) {
        expect(isInstantEvalBusy({ ...idle, chips, runs: { "run-1": { status } } })).toBe(false);
      }
      expect(isInstantEvalBusy({ ...idle, chips: [{ runId: null }], runs: {} })).toBe(false);
    });
  });
});

describe("given a run stopped short of its total", () => {
  describe("when the chip is marked", () => {
    /** @scenario "Stop cancels the run and keeps the chip as partial" */
    it("reads partial, naming judged versus total", () => {
      const stopped = { status: "cancelled" as const, progress: 3_200, total: 10_000 };

      expect(instantEvalChipMark({ run: stopped, hasRun: true })).toBe(
        "(partial: 3,200 of 10,000 judged)",
      );
      expect(instantEvalChipMark({ run: stopped, hasRun: true, isSettled: false })).toBeNull();
      expect(
        instantEvalChipLabel({
          question: "the user is annoyed",
          mark: "(partial: 3,200 of 10,000 judged)",
        }),
      ).toBe('"the user is annoyed" (partial: 3,200 of 10,000 judged)');
      expect(
        instantEvalChipMark({
          run: { status: "finished", progress: 10_000, total: 10_000 },
          hasRun: true,
        }),
      ).toBeNull();
      expect(
        instantEvalChipMark({
          run: { status: "running", progress: 10, total: 10_000 },
          hasRun: true,
        }),
      ).toBeNull();
    });
  });

  describe("when the overlay labels are gathered", () => {
    it("labels the settled partial chip and the pending one, under their fields and questions", () => {
      expect(
        instantEvalChipMarks({
          chips: [
            { field: "eval", question: "the user is annoyed", runId: "run-1" },
            { field: "eval.trace", question: "the answer is wrong", runId: null },
            { field: "eval", question: "still judging", runId: "run-2" },
          ],
          runs: {
            "run-1": { status: "cancelled", progress: 3_200, total: 10_000 },
            "run-2": { status: "running", progress: 10, total: 10_000 },
          },
          settled: { "run-1": true },
        }),
      ).toEqual({
        eval: { "the user is annoyed": '"the user is annoyed" (partial: 3,200 of 10,000 judged)' },
        "eval.trace": { "the answer is wrong": '"the answer is wrong" (pending)' },
      });
    });
  });
});
