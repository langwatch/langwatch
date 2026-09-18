/**
 * A judged page, turned into the rows kept and the numbers reported.
 *
 * @see ../judgments.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import {
  INSTANT_EVAL_PAGE_FAILURE_CEILING,
  instantEvalPageFailureRate,
  instantEvalSkipReason,
  mapInstantEvalPage,
} from "../judgments";
import { instantEvalRunQuestions } from "../questions";
import type { InstantEvalRowKey } from "../row-source";

const NOW = 1_758_000_000_000;

const calls: LangWatchQLAppFunctionCall[] = [
  {
    column: "annoyed",
    function: "eval",
    options: ["The customer sounds annoyed"],
    source: { function: "conversation_bounded", options: [8000, ""] },
  },
  {
    column: "intent",
    function: "eval_category",
    options: ["What do they want", ["refund: money back", "bug: broken"]],
    source: { function: "conversation_bounded", options: [8000, ""] },
  },
  {
    column: "helpfulness",
    function: "eval_score",
    options: ["How helpful", 1, 5],
    source: { function: "conversation_bounded", options: [8000, ""] },
  },
];

const questions = instantEvalRunQuestions(calls);

function keys(...traceIds: string[]): InstantEvalRowKey[] {
  return traceIds.map((traceId) => ({
    traceId,
    threadId: `thread-${traceId}`,
    spanId: "",
    occurredAt: NOW - 1000,
  }));
}

/** The same keys for a statement whose rows are one per span. */
function spanKeys(
  ...pairs: [traceId: string, spanId: string][]
): InstantEvalRowKey[] {
  return pairs.map(([traceId, spanId]) => ({
    traceId,
    threadId: `thread-${traceId}`,
    spanId,
    occurredAt: NOW - 1000,
  }));
}

describe("given a statement with several rows per trace", () => {
  describe("when the page is mapped", () => {
    /** @scenario "A statement with one row per span writes one judgement per span" */
    it("writes a judgement per span rather than collapsing the trace", () => {
      const { records } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions: instantEvalRunQuestions([
          calls[0] as LangWatchQLAppFunctionCall,
        ]),
        rows: [
          { TraceId: "t1", SpanId: "s1", annoyed: 0.9 },
          { TraceId: "t1", SpanId: "s2", annoyed: 0.1 },
        ],
        keys: spanKeys(["t1", "s1"], ["t1", "s2"]),
        skipReason: "",
        now: NOW,
      });

      // The judgement key is (TenantId, RunId, TraceId, SpanId, QuestionId), so
      // two spans of one trace are two rows and not one overwriting the other.
      expect(records).toHaveLength(2);
      expect(records.map((record) => record.SpanId)).toEqual(["s1", "s2"]);
      expect(records.map((record) => record.Passed)).toEqual([1, 0]);
    });
  });
});

describe("given a page of judged rows", () => {
  describe("when it is mapped", () => {
    /** @scenario "One judgement row is written per trace and question" */
    it("writes one row per trace and question", () => {
      const { records } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions,
        rows: [
          { TraceId: "t1", annoyed: 0.9, intent: "refund", helpfulness: 4.2 },
          { TraceId: "t2", annoyed: 0.1, intent: "bug", helpfulness: 2.0 },
        ],
        keys: keys("t1", "t2"),
        skipReason: "",
        now: NOW,
      });

      expect(records).toHaveLength(6);
      expect(
        records.map((record) => [record.TraceId, record.QuestionId]),
      ).toEqual([
        ["t1", "annoyed"],
        ["t1", "intent"],
        ["t1", "helpfulness"],
        ["t2", "annoyed"],
        ["t2", "intent"],
        ["t2", "helpfulness"],
      ]);
    });

    /** @scenario "One judgement row is written per trace and question" */
    it("carries the run, the trace, the question and its verdict", () => {
      const { records } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions,
        rows: [
          { TraceId: "t1", annoyed: 0.9, intent: "refund", helpfulness: 4.2 },
        ],
        keys: keys("t1"),
        skipReason: "",
        now: NOW,
      });

      expect(records[0]).toMatchObject({
        TenantId: "project-1",
        RunId: "run-1",
        TraceId: "t1",
        QuestionId: "annoyed",
        ThreadId: "thread-t1",
        Kind: "boolean",
        Status: "judged",
        Probability: 0.9,
        Passed: 1,
      });
      expect(records[1]).toMatchObject({ Kind: "category", Label: "refund" });
      expect(records[2]).toMatchObject({ Kind: "score", Score: 4.2 });
    });

    /** @scenario "No judged text is stored" */
    it("holds no judged text on any column", () => {
      const { records } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions,
        rows: [
          {
            TraceId: "t1",
            conversation: "User: this is broken\nAssistant: sorry",
            annoyed: 0.9,
            intent: "bug",
            helpfulness: 3,
          },
        ],
        keys: keys("t1"),
        skipReason: "",
        now: NOW,
      });

      expect(JSON.stringify(records)).not.toContain("this is broken");
    });

    /** @scenario "A matched judgement is one that passed, scored or landed on a label" */
    it("counts a boolean as matched only when it passed", () => {
      const { counters } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions: instantEvalRunQuestions([
          calls[0] as LangWatchQLAppFunctionCall,
        ]),
        rows: [
          { TraceId: "t1", annoyed: 0.9 },
          { TraceId: "t2", annoyed: 0.2 },
        ],
        keys: keys("t1", "t2"),
        skipReason: "",
        now: NOW,
      });

      expect(counters.matched).toBe(1);
      expect(counters.matchedByQuestion).toEqual({ annoyed: 1 });
    });

    /** @scenario "A matched judgement is one that passed, scored or landed on a label" */
    it("counts a score and a category as judged", () => {
      const { counters } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions: instantEvalRunQuestions(calls.slice(1)),
        rows: [{ TraceId: "t1", intent: "bug", helpfulness: 3 }],
        keys: keys("t1"),
        skipReason: "",
        now: NOW,
      });

      expect(counters.matchedByQuestion).toEqual({ intent: 1, helpfulness: 1 });
      // No boolean question, so there is no "yes" to count: the headline is
      // absent rather than the sum of every judged row.
      expect(counters.matched).toBeNull();
    });
  });

  describe("when the judge answered nothing for a row", () => {
    it("records a skip with the page's reason", () => {
      const { records, counters } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions: instantEvalRunQuestions([
          calls[0] as LangWatchQLAppFunctionCall,
        ]),
        rows: [{ TraceId: "t1", annoyed: null }],
        keys: keys("t1"),
        skipReason: "classifier_not_configured",
        now: NOW,
      });

      expect(records[0]).toMatchObject({
        Status: "skipped",
        Error: "classifier_not_configured",
        Probability: null,
        Passed: null,
      });
      expect(counters).toMatchObject({ skipped: 1, failed: 0, matched: 0 });
    });

    it("records a failure where the judge was asked and did not answer", () => {
      const { records, counters } = mapInstantEvalPage({
        tenantId: "project-1",
        runId: "run-1",
        questions: instantEvalRunQuestions([
          calls[0] as LangWatchQLAppFunctionCall,
        ]),
        rows: [{ TraceId: "t1", annoyed: null }],
        keys: keys("t1"),
        skipReason: "classifier_failed",
        now: NOW,
      });

      expect(records[0]).toMatchObject({ Status: "failed" });
      expect(counters).toMatchObject({ failed: 1, skipped: 0 });
    });
  });
});

describe("given a page's skip reasons", () => {
  describe("when one reason is chosen for the page", () => {
    it("takes the commonest", () => {
      expect(
        instantEvalSkipReason({
          classifier_rate_limited: 3,
          classifier_input_too_large: 1,
        }),
      ).toBe("classifier_rate_limited");
    });

    it("prefers a failure over a decline on a tie", () => {
      expect(
        instantEvalSkipReason({
          classifier_input_too_large: 2,
          classifier_failed: 2,
        }),
      ).toBe("classifier_failed");
    });

    it("reports nothing when nothing was skipped", () => {
      expect(instantEvalSkipReason({})).toBe("");
    });
  });
});

describe("given a page's counters", () => {
  describe("when the failure rate is measured", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("puts a mostly failed page past the ceiling", () => {
      const rate = instantEvalPageFailureRate({
        counters: {
          rows: 10,
          matched: 0,
          matchedByQuestion: {},
          failed: 21,
          skipped: 0,
        },
        questions: 3,
      });

      expect(rate).toBeGreaterThan(INSTANT_EVAL_PAGE_FAILURE_CEILING);
    });

    /** @scenario "A page that partly failed is recorded with its failures counted" */
    it("keeps a partly failed page under the ceiling", () => {
      const rate = instantEvalPageFailureRate({
        counters: {
          rows: 10,
          matched: 5,
          matchedByQuestion: {},
          failed: 3,
          skipped: 0,
        },
        questions: 3,
      });

      expect(rate).toBeLessThan(INSTANT_EVAL_PAGE_FAILURE_CEILING);
    });

    it("counts a deliberate skip as no failure at all", () => {
      const rate = instantEvalPageFailureRate({
        counters: {
          rows: 10,
          matched: 0,
          matchedByQuestion: {},
          failed: 0,
          skipped: 30,
        },
        questions: 3,
      });

      expect(rate).toBe(0);
    });

    it("reports nothing for an empty page", () => {
      expect(
        instantEvalPageFailureRate({
          counters: {
            rows: 0,
            matched: 0,
            matchedByQuestion: {},
            failed: 0,
            skipped: 0,
          },
          questions: 3,
        }),
      ).toBe(0);
    });
  });
});
