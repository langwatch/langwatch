/**
 * `eval:"question"`: an Instant Eval run's verdicts as a filter condition.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import {
  parseTraceQuerySyntax,
  type ResolvedInstantEvalRun,
  SEARCH_FIELDS,
  type TagToken,
  UNSUPPORTED,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { FIELD_DEFS } from "../clickhouse.trace-query-fields.repository.ts";
import { ClickHouseTraceQueryRepository } from "../clickhouse.trace-query.repository.ts";

const traceQueryRepository = ClickHouseTraceQueryRepository.create();
const TENANT = "project-1";
const WINDOW = { from: 1_000, to: 2_000 };

const run = (overrides: Partial<ResolvedInstantEvalRun> = {}): ResolvedInstantEvalRun => ({
  question: "the user is annoyed",
  target: "traces",
  runId: "run-1",
  writtenFrom: 5_000,
  writtenUntil: 9_000,
  ...overrides,
});

const compile = (queryText: string, evalRuns?: ResolvedInstantEvalRun[]) =>
  traceQueryRepository.translateFilter({
    queryText,
    tenantId: TENANT,
    timeRange: WINDOW,
    ...(evalRuns ? { evalRuns } : {}),
  });

describe("given an eval chip with a registered run", () => {
  describe("when the filter is compiled for ClickHouse", () => {
    /** @scenario "An eval chip with a registered run compiles to a verdict subquery" */
    it("keeps traces whose latest verdict for the run passed, TenantId first", () => {
      const result = compile('eval:"the user is annoyed"', [run()]);
      expect(result).not.toBeNull();
      expect(result?.sql).toBe(
        "TraceId IN (SELECT TraceId FROM instant_eval_judgments WHERE TenantId = {tenantId:String} AND RunId = {evalRun_0:String} AND CreatedAt >= fromUnixTimestamp64Milli({evalWrittenFrom_1:Int64}) AND CreatedAt <= fromUnixTimestamp64Milli({evalWrittenUntil_2:Int64}) GROUP BY TraceId, SpanId, QuestionId HAVING argMax(Passed, UpdatedAt) = 1)",
      );
      expect(result?.params).toMatchObject({
        tenantId: TENANT,
        evalRun_0: "run-1",
        evalWrittenFrom_1: 5_000,
        evalWrittenUntil_2: 9_000,
      });
    });

    /** @scenario "A conversation chip keeps every trace of a matched conversation" */
    it("compares the conversation id for a threads run", () => {
      const result = compile('eval.conversation:"the user is annoyed"', [
        run({ target: "threads", runId: "run-2" }),
      ]);
      expect(result?.sql).toContain(
        "Attributes['gen_ai.conversation.id'] IN (SELECT argMax(ThreadId, UpdatedAt) AS MatchedThreadId FROM instant_eval_judgments WHERE TenantId = {tenantId:String} AND RunId = {evalRun_0:String}",
      );
      expect(result?.sql).toContain(
        "HAVING argMax(Passed, UpdatedAt) = 1 AND MatchedThreadId != ''",
      );
      expect(result?.params.evalRun_0).toBe("run-2");
    });

    /** @scenario "A negated eval chip keeps the traces the judge did not match" */
    it("negates the verdict subquery under NOT", () => {
      const result = compile('NOT eval:"the user is annoyed"', [run()]);
      expect(result?.sql).toMatch(/^NOT \(TraceId IN \(SELECT TraceId FROM instant_eval_judgments/);
    });

    it("matches the question by its words, whatever the spacing", () => {
      const result = compile('eval:"the  user is annoyed"', [run()]);
      expect(result?.sql).toContain("instant_eval_judgments");
    });
  });
});

describe("given an eval chip and no run that fits it", () => {
  describe("when a target modifier names another target", () => {
    /** @scenario "A target modifier only resolves a run of that target" */
    it("matches no rows", () => {
      const result = compile('eval.llm:"the answer is wrong"', [
        run({ question: "the answer is wrong", target: "traces" }),
      ]);
      expect(result?.sql).toBe("1 = 0");
    });
  });

  describe("when no run is registered at all", () => {
    /** @scenario "An eval chip with no registered run matches nothing" */
    it("matches no rows for a forcing spelling", () => {
      expect(compile('eval.trace:"the user is annoyed"')?.sql).toBe("1 = 0");
    });

    /** @scenario "A bare eval chip with no registered run keeps its older meaning" */
    it("reads the bare field as an evaluator name", () => {
      const result = compile("eval:faithfulness");
      expect(result?.sql).toContain("FROM evaluation_runs");
      expect(result?.sql).toContain("EvaluatorName = {evaluatorName_0:String}");
      expect(result?.params.evaluatorName_0).toBe("faithfulness");
    });
  });
});

describe("given a trigger evaluating an eval chip in memory", () => {
  describe("when the field is evaluated", () => {
    /** @scenario "The eval field cannot be evaluated in memory" */
    it("answers unsupported for a forcing spelling", () => {
      const tag = parseTraceQuerySyntax('eval.trace:"the user is annoyed"') as TagToken;
      const verdict = FIELD_DEFS["eval.trace"].evaluateInMemory(tag, false, {
        summary: {} as never,
      });
      expect(verdict).toBe(UNSUPPORTED);
    });
  });
});

describe("given the search field registry", () => {
  describe("when it is read", () => {
    /** @scenario "The eval field is in the query reference and the autocomplete" */
    it("lists the eval field and its three target spellings under the eval group", () => {
      for (const field of ["eval", "eval.trace", "eval.conversation", "eval.llm"]) {
        expect(SEARCH_FIELDS[field]?.group).toBe("eval");
        expect(FIELD_DEFS[field as keyof typeof FIELD_DEFS]).toBeDefined();
      }
    });
  });
});
