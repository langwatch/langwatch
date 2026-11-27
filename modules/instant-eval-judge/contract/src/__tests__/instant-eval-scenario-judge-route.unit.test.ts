/**
 * The route table's scenario turn decision key: an LLM backend the table knows, or the table is
 * refused. @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_JOBS,
  instantEvalJudgeRouteTableSchema,
  isInstantEvalJudgeLlmBackend,
} from "../instant-eval-judge-route.ts";

function tableWith(scenarioDecision: unknown) {
  const slot = { instant: { primary: "decision" } };
  return {
    version: 1,
    defaultMode: { search: "instant", llm_judge: "instant", scenario_judge: "instant" },
    buckets: [{ name: "all", maxTokens: null }],
    arithmetic: {
      maxTokens: 0,
      source: { search: "request", llm_judge: "request", scenario_judge: "request" },
    },
    backends: {
      decision: { kind: "jev" },
      "llm-a": { kind: "openai_responses", model: "llm-model-a" },
    },
    routes: Object.fromEntries(
      INSTANT_EVAL_JUDGE_JOBS.map((job) => [job, { all: slot, arithmetic: slot }]),
    ),
    scenarioDecision,
  };
}

const issuesOf = (table: unknown): string[] => {
  const parsed = instantEvalJudgeRouteTableSchema.safeParse(table);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("given a route table with a scenarioDecision key", () => {
  /** @scenario "A route table names its scenario decision backend" */
  it("accepts an LLM backend and keeps it on the parsed table", () => {
    const table = instantEvalJudgeRouteTableSchema.parse(tableWith({ backend: "llm-a" }));

    expect(table.scenarioDecision).toEqual({ backend: "llm-a" });
    expect(isInstantEvalJudgeLlmBackend({ backend: "llm-a", table })).toBe(true);
    expect(isInstantEvalJudgeLlmBackend({ backend: "decision", table })).toBe(false);
  });

  /** @scenario "A route table names its scenario decision backend" */
  it("refuses a backend the table does not know", () => {
    expect(issuesOf(tableWith({ backend: "missing" }))).toEqual([
      "scenarioDecision: unknown backend missing",
    ]);
  });

  /** @scenario "A route table names its scenario decision backend" */
  it("refuses a decision model, which cannot take the judge's own tool call", () => {
    expect(issuesOf(tableWith({ backend: "decision" }))).toEqual([
      "scenarioDecision: decision is not an LLM backend",
    ]);
  });

  it("ships none on the public table", () => {
    expect(INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE.scenarioDecision).toBeUndefined();
  });
});
