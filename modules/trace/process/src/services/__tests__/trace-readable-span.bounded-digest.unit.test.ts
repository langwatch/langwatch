/**
 * The trace digest under a token budget: what it keeps, what it drops, and in
 * which order. Spec: specs/traces/trace-extraction-modules.feature.
 */
import { estimateTokens } from "@langwatch/scenario";
import { estimateTokensFromBytes, type Span } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { rankSpansForExpansion } from "../../rules/bounded-spans-digest.rules.ts";
import { TraceReadableSpanService } from "../trace-readable-span.service.ts";

const span = ({
  spanId,
  type = "span",
  name,
  startedAt = 0,
  finishedAt = 100,
  text = "body",
  error,
}: {
  spanId: string;
  type?: Span["type"];
  name: string;
  startedAt?: number;
  finishedAt?: number;
  text?: string;
  error?: string;
}): Span =>
  ({
    span_id: spanId,
    trace_id: "trace-1",
    type,
    name,
    timestamps: { started_at: startedAt, finished_at: finishedAt },
    input: { type: "text", value: text },
    output: { type: "text", value: text },
    ...(error ? { error: { has_error: true as const, message: error, stacktrace: [] } } : {}),
  }) as Span;

/** A body large enough that a handful of spans blow any small budget. */
const big = (label: string) => `${label} ${"payload ".repeat(400)}`;

const trace = [
  span({ spanId: "root", name: "root-span", text: big("root") }),
  span({ spanId: "slow", name: "slow-tool", type: "tool", finishedAt: 9_000, text: big("slow") }),
  span({ spanId: "model", name: "model-call", type: "llm", text: big("model") }),
  span({
    spanId: "boom",
    name: "failing-step",
    type: "tool",
    finishedAt: 10,
    text: big("boom"),
    error: "it broke",
  }),
];

const bounded = (spans: Span[], maxTokens: number) =>
  TraceReadableSpanService.formatSpansDigestBounded({ spans, maxTokens });

describe("the token estimate behind the budget", () => {
  /** @scenario "The token estimate counts bytes, not characters" */
  it("agrees with the judge's own, so a digest that fits here fits there", () => {
    for (const sample of ["", "hello", "a".repeat(999), "🙂漢字 mixed"]) {
      expect(estimateTokensFromBytes(sample)).toBe(estimateTokens(sample));
    }
  });
});

describe("rankSpansForExpansion", () => {
  describe("given a trace mixing an error, a model call and a slow tool", () => {
    /** @scenario "A digest over the budget becomes the structure plus the spans worth reading" */
    it("ranks the error first, then the model call, then by duration", () => {
      expect(rankSpansForExpansion(trace).map((s) => s.span_id)).toEqual([
        "boom",
        "model",
        "slow",
        "root",
      ]);
    });

    it("keeps the trace's own order between spans that tie", () => {
      const ties = [span({ spanId: "first", name: "a" }), span({ spanId: "second", name: "b" })];

      expect(rankSpansForExpansion(ties).map((s) => s.span_id)).toEqual(["first", "second"]);
    });
  });
});

describe("formatSpansDigestBounded", () => {
  describe("given a trace whose full digest fits the budget", () => {
    /** @scenario "A digest that fits the budget is returned in full" */
    it("returns the full digest and reports it untruncated", () => {
      const result = bounded([span({ spanId: "a", name: "root", text: "small" })], 8192);

      expect(result.isTruncated).toBe(false);
      expect(result.text).toContain("root");
      expect(result.text).toContain("small");
      expect(result.estimatedTokens).toBeLessThanOrEqual(8192);
    });
  });

  describe("given a trace whose full digest is larger than the budget", () => {
    /** @scenario "A digest over the budget becomes the structure plus the spans worth reading" */
    it("returns the span tree and reports it truncated", () => {
      const result = bounded(trace, 900);

      expect(result.isTruncated).toBe(true);
      // Every span is still named by the skeleton, even the ones not expanded.
      expect(result.text).toContain("root-span");
      expect(result.text).toContain("slow-tool");
      expect(result.text).toContain("model-call");
      expect(result.text).toContain("failing-step");
      expect(result.estimatedTokens).toBeLessThanOrEqual(900);
    });

    /** @scenario "A digest over the budget becomes the structure plus the spans worth reading" */
    it("spends the remaining budget expanding the highest-ranked spans", () => {
      const skeletonOnly = bounded(trace, 700);
      // Room for exactly one of these spans on top of the skeleton.
      const withExpansions = bounded(trace, 2_500);

      expect(withExpansions.isTruncated).toBe(true);
      expect(withExpansions.estimatedTokens).toBeGreaterThan(skeletonOnly.estimatedTokens);
      expect(withExpansions.estimatedTokens).toBeLessThanOrEqual(2_500);
      // Ranked first, so it is the body a reader gets when only some fit.
      expect(withExpansions.text).toContain("boom payload");
      // Everything ranked below it waits for a budget that fits them.
      expect(withExpansions.text).not.toContain("model payload");
      expect(withExpansions.text).not.toContain("slow payload");
      expect(withExpansions.text).not.toContain("root payload");
    });
  });

  describe("given a trace whose span tree alone is larger than the budget", () => {
    /** @scenario "A structure too large for the budget is cut" */
    it("cuts the tree to the budget and reports it truncated", () => {
      const spans = Array.from({ length: 200 }, (_, i) =>
        span({ spanId: `s${i}`, name: `step-number-${i}-with-a-long-name`, text: "x" }),
      );

      const result = bounded(spans, 120);

      expect(result.isTruncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(120);
    });
  });
});
