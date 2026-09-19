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
import { toExplorerRunInput } from "../tracesV2.instantEval";

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
          filter: "service:api",
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

    it("leaves the filter out when there are no other chips", () => {
      const input = toExplorerRunInput({
        projectId: "project-1",
        target: "traces",
        filter: "",
        window: { from: 1, to: 2 },
        question: { instructions: "the user is annoyed" },
        limit: 500,
      });
      expect(input.shorthand?.filter).toBeUndefined();
      expect(input.limit).toBe(500);
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
      });
      expect(isInstantEvalRunActive("running")).toBe(true);
      expect(isInstantEvalRunActive("cancelled")).toBe(false);
    });
  });
});
