/**
 * The Explorer's request as the run service reads it, and a run row as the
 * chip reads it. Spec: specs/traces-v2/instant-eval-search.feature
 */
import type { InstantEvalRunWire } from "@langwatch/instant-eval-contract";
import type { ExplorerInstantEvalRunInput } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  explorerJudgedFilter,
  toExplorerRunInput,
  toExplorerRunProgress,
} from "../trace-instant-eval-run.rules.ts";

const request = (
  overrides: Partial<ExplorerInstantEvalRunInput> = {},
): ExplorerInstantEvalRunInput => ({
  projectId: "project-1",
  target: "traces",
  filter: "",
  window: { from: 1_700_000_000_000, to: 1_700_003_600_000 },
  question: { instructions: "is the user annoyed" },
  ...overrides,
});

const run: InstantEvalRunWire = {
  id: "run-1",
  name: null,
  sql: "SELECT 1",
  parameters: {},
  questions: [],
  limit: 1000,
  status: "running",
  total: 120,
  progress: 40,
  matched: 7,
  matchedByQuestion: { matched: 7 },
  failed: 1,
  skipped: 2,
  tokens: 900,
  priceUsd: 0.12,
  error: null,
  createdAt: "2026-09-22T10:00:00Z",
  updatedAt: "2026-09-22T10:01:00Z",
  startedAt: "2026-09-22T10:00:01Z",
  finishedAt: null,
};

describe("toExplorerRunInput", () => {
  /** @scenario "The Explorer's request becomes the shorthand" */
  it("writes the shorthand with the window as ISO instants and one boolean question", () => {
    const input = toExplorerRunInput(
      request({ question: { instructions: "is the user annoyed", criteria: ["annoyed", "calm"] } }),
    );

    expect(input.shorthand).toMatchObject({
      target: "traces",
      start: "2023-11-14T22:13:20Z",
      end: "2023-11-14T23:13:20Z",
      questions: [
        {
          id: "matched",
          kind: "boolean",
          instructions: "is the user annoyed",
          criteria: ["annoyed", "calm"],
        },
      ],
    });
    expect(input.limit).toBeUndefined();
  });

  it("carries a limit only when the Explorer named one", () => {
    expect(toExplorerRunInput(request({ limit: 50 })).limit).toBe(50);
    expect("limit" in toExplorerRunInput(request())).toBe(false);
  });

  it("asks a question without criteria as one", () => {
    expect(toExplorerRunInput(request()).shorthand?.questions[0]).not.toHaveProperty("criteria");
  });
});

describe("explorerJudgedFilter", () => {
  /** @scenario "A run judges the rows the Explorer shows" */
  it("leaves out the Langy origin, drops any eval chip, and steps aside when an origin is named", () => {
    expect(explorerJudgedFilter("status:error")).toBe("status:error AND NOT origin:langy");
    expect(explorerJudgedFilter('status:error AND eval:"is it rude"')).toBe(
      "status:error AND NOT origin:langy",
    );
    expect(explorerJudgedFilter("origin:langy")).toBe("origin:langy");
  });

  it("drops a filter's eval chip, so no run compiles a judgement it has no run reference for", () => {
    const input = toExplorerRunInput(
      request({
        filter: 'eval:"the user is annoyed" AND service:api',
        question: { instructions: "the user asked twice" },
      }),
    );

    expect(input.shorthand?.filter).toBe("service:api AND NOT origin:langy");
  });
});

describe("toExplorerRunProgress", () => {
  it("answers the counters and nothing else", () => {
    expect(toExplorerRunProgress(run)).toEqual({
      id: "run-1",
      status: "running",
      total: 120,
      progress: 40,
      matched: 7,
      failed: 1,
      skipped: 2,
      error: null,
      priceUsd: 0.12,
      finishedAtMs: null,
    });
  });

  it("reads the end of a finished run as epoch milliseconds", () => {
    expect(
      toExplorerRunProgress({ ...run, status: "finished", finishedAt: "2026-09-22T10:05:00Z" })
        .finishedAtMs,
    ).toBe(Date.parse("2026-09-22T10:05:00Z"));
  });
});
