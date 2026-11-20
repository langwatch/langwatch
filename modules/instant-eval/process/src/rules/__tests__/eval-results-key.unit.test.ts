/**
 * The recall key of a kept result: what is hashed, what is left out, and which cells have none.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  evalResultsInputHash,
  evalResultsJudgeModelOf,
  evalResultsQuestionHash,
  findEvalResultsCellKeys,
} from "../eval-results-key.rules.ts";
import type { InstantEvalRunQuestion } from "../instant-eval-run-questions.rules.ts";

const OCCURRED_AT = "2026-11-02 10:00:00.000";

function question(overrides: Partial<InstantEvalRunQuestion> = {}): InstantEvalRunQuestion {
  return {
    id: "annoyed",
    function: "eval",
    kind: "boolean",
    reads: "probability",
    question: { id: "annoyed", kind: "boolean", instructions: "Is the customer annoyed?" },
    judgedText: { function: "llm_readable_trace", keyKind: "trace" },
    ...overrides,
  };
}

describe("evalResultsQuestionHash", () => {
  describe("given the same question under two column names and spacing", () => {
    /** @scenario "The question hash ignores the column alias and spacing" */
    it("hashes both the same, and a different question or criteria differently", () => {
      const asked = evalResultsQuestionHash({
        id: "annoyed",
        kind: "boolean",
        instructions: "Is the customer annoyed?",
      });

      expect(
        evalResultsQuestionHash({
          id: "upset",
          kind: "boolean",
          instructions: "  Is the   customer annoyed? ",
        }),
      ).toBe(asked);
      expect(
        evalResultsQuestionHash({ id: "annoyed", kind: "boolean", instructions: "Is it rude?" }),
      ).not.toBe(asked);
      expect(
        evalResultsQuestionHash({
          id: "annoyed",
          kind: "boolean",
          instructions: "Is the customer annoyed?",
          criteria: ["annoyed", "calm"],
        }),
      ).not.toBe(asked);
    });
  });
});

describe("evalResultsInputHash", () => {
  describe("given one text read by two extractions", () => {
    /** @scenario "The input hash covers the judged column and its text" */
    it("hashes each its own, and a changed text differently", () => {
      const trace = evalResultsInputHash({ judgedColumn: "llm_readable_trace", text: "hello" });

      expect(evalResultsInputHash({ judgedColumn: "llm_messages", text: "hello" })).not.toBe(trace);
      expect(evalResultsInputHash({ judgedColumn: "llm_readable_trace", text: "hello!" })).not.toBe(
        trace,
      );
      expect(evalResultsInputHash({ judgedColumn: "llm_readable_trace", text: "hello" })).toBe(
        trace,
      );
    });
  });
});

describe("findEvalResultsCellKeys", () => {
  const row = { TraceId: "trace-1", SpanId: "span-1", OccurredAt: OCCURRED_AT };

  describe("given an eval over a conversation and one over a plain column", () => {
    /** @scenario "A thread's or a literal text is not kept" */
    it("keys neither", () => {
      const { judgedText: _judgedText, ...literal } = question();

      expect(findEvalResultsCellKeys({ row, question: literal, text: "hello" })).toEqual([]);
    });
  });

  describe("given a row naming a trace and a span", () => {
    /** @scenario "A span's text is keyed by its span, a trace's by the trace alone" */
    it("keys a span's text by the span and a trace's text by the trace alone", () => {
      const [span] = findEvalResultsCellKeys({
        row,
        question: question({ judgedText: { function: "llm_messages_span", keyKind: "span" } }),
        text: "hello",
      });
      const [trace] = findEvalResultsCellKeys({ row, question: question(), text: "hello" });

      expect(span).toMatchObject({
        traceId: "trace-1",
        spanId: "span-1",
        judgedColumn: "llm_messages_span",
      });
      expect(trace).toMatchObject({
        traceId: "trace-1",
        spanId: "",
        judgedColumn: "llm_readable_trace",
        occurredAt: Date.UTC(2026, 10, 2, 10),
      });
    });
  });

  describe("given a row with no trace, or no trace time", () => {
    /** @scenario "A row with no trace or no trace time is not kept" */
    it("keys neither", () => {
      const noTrace = { OccurredAt: OCCURRED_AT };
      const noTime = { TraceId: "trace-1" };

      expect(findEvalResultsCellKeys({ row: noTrace, question: question(), text: "x" })).toEqual(
        [],
      );
      expect(findEvalResultsCellKeys({ row: noTime, question: question(), text: "x" })).toEqual([]);
    });
  });
});

describe("evalResultsJudgeModelOf", () => {
  describe("given a project on LangWatch's judge and one on its own decision model", () => {
    /** @scenario "The judge model is the own decision model or LangWatch's judge" */
    it("records LangWatch's judge for the first and the own model id for the second", () => {
      expect(evalResultsJudgeModelOf({ kind: "langwatch" })).toBe(INSTANT_EVAL_JUDGE_MODEL_ID);
      expect(
        evalResultsJudgeModelOf({
          kind: "own_unavailable",
          model: "azure/decisions:gpt-6-luna",
        }),
      ).toBe("azure/decisions:gpt-6-luna");
    });
  });
});
