/**
 * What the Explorer's Instant Eval request becomes at the run service, and
 * what a run's row becomes for the Explorer.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("tRPC wraps the run
 * service for the Explorer").
 */
import { describe, expect, it } from "vitest";
import {
  isInstantEvalRunActive,
  toInstantEvalExplorerRun,
} from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import type { InstantEvalRunRow } from "~/server/app-layer/instant-evals/run/instant-eval-run.repository";
import {
  explorerInstantEvalRunSchema,
  toExplorerRunInput,
} from "../tracesV2.instantEval";

describe("given the Explorer's request", () => {
  describe("when it is turned into the run service's input", () => {
    /** @scenario "The Explorer's request becomes the shorthand" */
    it("is a shorthand with the window as ISO instants and one boolean question", () => {
      const input = toExplorerRunInput({
        projectId: "project-1",
        target: "threads",
        filter: " service:api ",
        window: { from: Date.UTC(2026, 8, 10), to: Date.UTC(2026, 8, 11) },
        question: {
          instructions: "the user is annoyed",
          criteria: ["the user complains", "the user is calm"],
        },
      });
      expect(input).toEqual({
        shorthand: {
          target: "threads",
          filter: "service:api AND NOT origin:langy",
          start: "2026-09-10T00:00:00.000Z",
          end: "2026-09-11T00:00:00.000Z",
          questions: [
            {
              id: "matched",
              kind: "boolean",
              instructions: "the user is annoyed",
              criteria: ["the user complains", "the user is calm"],
            },
          ],
        },
      });
    });

    /** @scenario "A run judges the rows the Explorer shows" */
    it("leaves out the origin the table hides when there are no other chips", () => {
      const input = toExplorerRunInput({
        projectId: "project-1",
        target: "traces",
        filter: "",
        window: { from: 1, to: 2 },
        question: { instructions: "the user is annoyed" },
        limit: 500,
      });
      expect(input.shorthand?.filter).toBe("NOT origin:langy");
      expect(input.limit).toBe(500);
    });

    /** @scenario "A run judges the rows the Explorer shows" */
    it("leaves a filter that names an origin as asked", () => {
      const input = toExplorerRunInput({
        projectId: "project-1",
        target: "traces",
        filter: "origin:langy OR origin:application",
        window: { from: 1, to: 2 },
        question: { instructions: "the user is annoyed" },
      });
      expect(input.shorthand?.filter).toBe(
        "origin:langy OR origin:application",
      );
    });
  });

  describe("when the filter still carries an eval chip", () => {
    /** @scenario "A second question judges the same rows as the first" */
    it("drops it, so no run compiles a judgement it has no run reference for", () => {
      const input = toExplorerRunInput({
        projectId: "project-1",
        target: "traces",
        filter: 'eval:"the user is annoyed" AND service:api',
        window: { from: 1, to: 2 },
        question: { instructions: "the user asked twice" },
      });
      expect(input.shorthand?.filter).toBe("service:api AND NOT origin:langy");
    });
  });

  describe("when a window bound is past what a date can represent", () => {
    /** @scenario "A window outside the calendar range is refused as a validation error" */
    it("is refused by the schema rather than raising while the instants are written", () => {
      const request = {
        projectId: "project-1",
        target: "traces" as const,
        filter: "",
        window: { from: 0, to: 9_000_000_000_000_000 },
        question: { instructions: "the user is annoyed" },
      };
      expect(explorerInstantEvalRunSchema.safeParse(request).success).toBe(
        false,
      );
      expect(() => toExplorerRunInput(request)).toThrow(RangeError);
    });
  });
});

describe("given a run's row", () => {
  describe("when it is read for the Explorer", () => {
    /** @scenario "The Explorer's request becomes the shorthand" */
    it("answers the counters in the Explorer's own shape", () => {
      const row = {
        id: "run-1",
        status: "RUNNING",
        total: 10_000,
        progress: 3_200,
        matched: 412,
        failed: 1,
        skipped: 2,
        error: null,
        priceUsd: 0.31,
        finishedAt: null,
      } as unknown as InstantEvalRunRow;
      expect(toInstantEvalExplorerRun(row)).toEqual({
        id: "run-1",
        status: "running",
        total: 10_000,
        progress: 3_200,
        matched: 412,
        failed: 1,
        skipped: 2,
        error: null,
        priceUsd: 0.31,
        finishedAtMs: null,
      });
      expect(isInstantEvalRunActive("running")).toBe(true);
      expect(isInstantEvalRunActive("cancelled")).toBe(false);
    });
  });
});
