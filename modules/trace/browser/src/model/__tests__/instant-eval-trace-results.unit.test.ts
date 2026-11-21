/**
 * How the drawer lists a trace's kept Instant Evals results: the verdict in words, and each
 * result labelled with who asked, which judge answered and when.
 * @see modules/trace/specs/trace-instant-eval-results.feature
 */
import type { InstantEvalTraceResultWire } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  instantEvalJudgedTextLabel,
  instantEvalVerdictLabel,
  toInstantEvalResultEntry,
} from "../instant-eval-trace-results.ts";

function result(overrides: Partial<InstantEvalTraceResultWire> = {}): InstantEvalTraceResultWire {
  return {
    spanId: "",
    judgedColumn: "output",
    question: "Is the customer annoyed?",
    kind: "boolean",
    status: "judged",
    probability: 0.87,
    score: null,
    label: null,
    judgeModel: "langwatch/instant-evals",
    judgedAt: 1_762_000_000_000,
    source: "ask",
    sourceId: "query-1",
    ...overrides,
  };
}

describe("toInstantEvalResultEntry", () => {
  describe("given a result from each source", () => {
    /** @scenario "Each Instant Evals result names its source, judge model and judged time" */
    it("labels it Ask, Run or Dashboard, with its judge model and judged time", () => {
      const entries = (["ask", "run", "dashboard"] as const).map((source) =>
        toInstantEvalResultEntry(result({ source })),
      );

      expect(entries.map((entry) => entry.sourceLabel)).toEqual(["Ask", "Run", "Dashboard"]);
      expect(entries[0]).toMatchObject({
        question: "Is the customer annoyed?",
        judgeModel: "langwatch/instant-evals",
        judgedAt: 1_762_000_000_000,
        judgedColumn: "output",
      });
    });
  });

  describe("given results on the trace's own text and on a span", () => {
    /** @scenario "Each Instant Evals result names its source, judge model and judged time" */
    it("names the span only for the span's result", () => {
      expect(toInstantEvalResultEntry(result()).spanId).toBeUndefined();
      expect(toInstantEvalResultEntry(result({ spanId: "span-1" })).spanId).toBe("span-1");
    });
  });
});

describe("instantEvalJudgedTextLabel", () => {
  describe("given each judged column a writer stores", () => {
    it("reads it in plain words", () => {
      const columns = [
        "llm_readable_trace",
        "llm_messages",
        "llm_input_messages",
        "llm_output_messages",
        "llm_messages_span",
        "trace_json",
        "monitor",
      ];

      expect(columns.map(instantEvalJudgedTextLabel)).toEqual([
        "trace",
        "messages",
        "input messages",
        "output messages",
        "span messages",
        "full trace",
        "monitor",
      ]);
    });
  });

  describe("given a judged column it does not know", () => {
    it("reads it as stored", () => {
      expect(instantEvalJudgedTextLabel("custom_extraction")).toBe("custom_extraction");
    });
  });

  describe("given a result as the drawer lists it", () => {
    it("carries the plain label beside the stored column", () => {
      const entry = toInstantEvalResultEntry(result({ judgedColumn: "llm_messages_span" }));

      expect(entry).toMatchObject({
        judgedColumn: "llm_messages_span",
        judgedTextLabel: "span messages",
      });
    });
  });
});

describe("instantEvalVerdictLabel", () => {
  describe("given a judged result", () => {
    /** @scenario "A verdict reads as its likelihood, score or category, or why there is none" */
    it("reads a boolean's likelihood, a score, or a category", () => {
      expect(instantEvalVerdictLabel(result())).toBe("87% yes");
      expect(instantEvalVerdictLabel(result({ probability: null, score: 4 }))).toBe("Score 4");
      expect(instantEvalVerdictLabel(result({ probability: null, label: "refund" }))).toBe(
        "refund",
      );
    });
  });

  describe("given a result no judge answered", () => {
    /** @scenario "A verdict reads as its likelihood, score or category, or why there is none" */
    it("reads as could not judge or skipped, never as a verdict", () => {
      expect(instantEvalVerdictLabel(result({ status: "failed", probability: null }))).toBe(
        "Could not judge",
      );
      expect(instantEvalVerdictLabel(result({ status: "skipped", probability: null }))).toBe(
        "Skipped",
      );
    });
  });
});
