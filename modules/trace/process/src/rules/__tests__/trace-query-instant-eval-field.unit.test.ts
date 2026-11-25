/**
 * `eval:"question"`: an Instant Eval run's verdicts as a filter condition.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { tenantSet } from "@langwatch/clickhouse-client";
import {
  parseTraceQuerySyntax,
  type ResolvedInstantEvalRun,
  SEARCH_FIELDS,
  type TagToken,
  UNSUPPORTED,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  traceQueryFields,
  traceQueryTranslation,
} from "../../services/__tests__/fixtures/trace-query-services.fixtures.ts";

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
  traceQueryTranslation.translateFilter({
    queryText,
    timeRange: WINDOW,
    ...(evalRuns ? { evalRuns } : {}),
  });

describe("given an eval chip with a registered run", () => {
  describe("when the filter is compiled for ClickHouse", () => {
    /** @scenario "An eval chip with a registered run compiles to a verdict subquery" */
    it("keeps traces whose latest verdict for the run passed, tenant marker first", () => {
      const result = compile('eval:"the user is annoyed"', [run()]);
      expect(result).not.toBeNull();
      expect(result?.sql).toBe(
        `((TenantId, TraceId) IN (SELECT TenantId, TraceId FROM instant_eval_judgments WHERE ${tenantSet()} AND RunId = {evalRun_0:String} AND CreatedAt >= fromUnixTimestamp64Milli({evalWrittenFrom_1:Int64}) AND CreatedAt <= fromUnixTimestamp64Milli({evalWrittenUntil_2:Int64}) GROUP BY TenantId, TraceId, SpanId, QuestionId HAVING argMax(Passed, UpdatedAt) = 1))`,
      );
      expect(result?.params).toMatchObject({
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
        `((TenantId, Attributes['gen_ai.conversation.id']) IN (SELECT TenantId, argMax(ThreadId, UpdatedAt) AS MatchedThreadId FROM instant_eval_judgments WHERE ${tenantSet()} AND RunId = {evalRun_0:String}`,
      );
      expect(result?.sql).toContain(
        "HAVING argMax(Passed, UpdatedAt) = 1 AND MatchedThreadId != ''",
      );
      expect(result?.params.evalRun_0).toBe("run-2");
    });

    /** @scenario "A negated eval chip keeps the traces the judge did not match" */
    it("keeps only judged rows whose latest verdict did not pass, under NOT", () => {
      const result = compile('NOT eval:"the user is annoyed"', [run()]);
      const where = `${tenantSet()} AND RunId = {evalRun_0:String} AND CreatedAt >= fromUnixTimestamp64Milli({evalWrittenFrom_1:Int64}) AND CreatedAt <= fromUnixTimestamp64Milli({evalWrittenUntil_2:Int64})`;
      const group = "GROUP BY TenantId, TraceId, SpanId, QuestionId";
      // A row the run never judged (past the cap, after a stop, newer than the run) is in neither
      // set, so it is not listed as a non-match.
      expect(result?.sql).toBe(
        `(((TenantId, TraceId) IN (SELECT TenantId, TraceId FROM instant_eval_judgments WHERE ${where} ${group} HAVING argMax(coalesce(Passed, 2), UpdatedAt) = 0))` +
          ` AND ((TenantId, TraceId) NOT IN (SELECT TenantId, TraceId FROM instant_eval_judgments WHERE ${where} ${group} HAVING argMax(Passed, UpdatedAt) = 1)))`,
      );
    });

    /** @scenario "A negated eval chip keeps the traces the judge did not match" */
    it("keeps only judged conversations that did not pass, for a threads run under NOT", () => {
      const result = compile('NOT eval.conversation:"the user is annoyed"', [
        run({ target: "threads" }),
      ]);
      expect(result?.sql).toMatch(
        /^\(\(\(TenantId, Attributes\['gen_ai\.conversation\.id'\]\) IN \(SELECT/,
      );
      expect(result?.sql).toContain(
        "HAVING argMax(coalesce(Passed, 2), UpdatedAt) = 0 AND MatchedThreadId != ''",
      );
      expect(result?.sql).toContain(") NOT IN (SELECT TenantId, argMax(ThreadId, UpdatedAt)");
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

    /** @scenario "An eval chip with no registered run matches nothing" */
    it("matches no rows for a forcing spelling under NOT either", () => {
      expect(compile('NOT eval.trace:"the user is annoyed"')?.sql).toBe("1 = 0");
    });

    /** @scenario "A bare eval chip with no registered run keeps its older meaning" */
    it("reads the bare field as an evaluator name", () => {
      const result = compile("eval:faithfulness");
      expect(result?.sql).toContain("FROM evaluation_runs");
      expect(result?.sql).toContain("EvaluatorName = {evaluatorName_0:String}");
      expect(result?.params.evaluatorName_0).toBe("faithfulness");
    });
  });

  describe("when a NOT reaches the chip across an OR, beside a sibling chip with a run", () => {
    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it.each([
      'NOT eval:"the user is annoyed" OR eval.trace:"the user is annoyed"',
      'NOT eval.trace:"the user is annoyed" OR eval:"the user is annoyed"',
    ])("applies the run to the sibling only, the NOT matching nothing: %s", (queryText) => {
      const result = compile(queryText, [run()]);
      const runParams = Object.values(result?.params ?? {}).filter((value) => value === "run-1");
      expect(runParams).toHaveLength(1);
      expect(result?.sql).toMatch(/^\(?1 = 0 OR /);
      expect(result?.sql).not.toContain("NOT (1 = 0)");
      expect(result?.sql).not.toContain("FROM evaluation_runs");
    });

    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("matches nothing for the NOT alone, so counts and exports list no unjudged row", () => {
      expect(compile('NOT eval.trace:"the user is annoyed" OR status:error', [run()])?.sql).toMatch(
        /^\(?1 = 0 OR /,
      );
    });

    /** @scenario "A NOT the run of a typed chip cannot answer is refused" */
    it("applies the run to a positive sibling spelled the same way, as it applies none to the NOT", () => {
      const result = compile(
        '(NOT eval:"the user is annoyed" OR status:error) AND eval:"the user is annoyed"',
        [run()],
      );
      const runParams = Object.values(result?.params ?? {}).filter((value) => value === "run-1");
      expect(runParams).toHaveLength(1);
      expect(result?.sql).toContain("HAVING argMax(Passed, UpdatedAt) = 1");
      expect(result?.sql).toContain("1 = 0 OR ");
      expect(result?.sql).not.toContain("FROM evaluation_runs");
    });
  });
});

describe("given a trigger evaluating an eval chip in memory", () => {
  describe("when the field is evaluated", () => {
    /** @scenario "The eval field cannot be evaluated in memory" */
    it("answers unsupported for a forcing spelling", () => {
      const tag = parseTraceQuerySyntax('eval.trace:"the user is annoyed"') as TagToken;
      const verdict = traceQueryFields.fieldDefs["eval.trace"].evaluateInMemory(tag, false, {
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
        expect(
          traceQueryFields.fieldDefs[field as keyof typeof traceQueryFields.fieldDefs],
        ).toBeDefined();
      }
    });
  });
});
