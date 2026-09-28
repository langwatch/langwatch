/**
 * The trace digest under a token budget: what it keeps, what it drops, and in
 * which order. Spec: specs/traces/trace-extraction-modules.feature.
 */
import { estimateTokens } from "@langwatch/scenario";
import { estimateTokensFromBytes, type Span } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { rankSpansForExpansion } from "../../rules/bounded-spans-digest.rules.ts";
import { formatSpansDigestBounded } from "../../rules/trace-readable-span.rules.ts";

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
  formatSpansDigestBounded({ spans, maxTokens });

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
      const skeletonOnly = bounded(trace, 150);
      const withExpansions = bounded(trace, 1_200);

      expect(withExpansions.isTruncated).toBe(true);
      expect(withExpansions.estimatedTokens).toBeGreaterThan(skeletonOnly.estimatedTokens);
      expect(withExpansions.estimatedTokens).toBeLessThanOrEqual(1_200);
      // Ranked first, so it is the body a reader gets when only some fit.
      expect(withExpansions.text).toContain("boom payload");
      // The next in rank gets what is left, cut in the middle.
      expect(withExpansions.text).toContain("model payload");
      expect(withExpansions.text).toMatch(/tokens omitted from the middle/);
      // Everything ranked below them waits for a budget that fits them.
      expect(withExpansions.text).not.toContain("slow payload");
      expect(withExpansions.text).not.toContain("root payload");
    });
  });

  describe("given a long agent loop and an 8,000-token budget", () => {
    const loop = Array.from({ length: 16 }, (_, i) =>
      span({
        spanId: `step${i}`,
        name: `step-${i}`,
        type: i % 2 === 0 ? "llm" : "tool",
        startedAt: i * 1_000,
        finishedAt: i * 1_000 + 900,
        text: `step ${i} ${"reasoning about the refund policy ".repeat(60)}`,
      }),
    );

    /** @scenario "A bounded digest spends the caller's budget, not the judge tool's" */
    it("expands past the judge tool's 4,096-token limit, up to the budget", () => {
      const result = bounded(loop, 8_000);

      expect(result.isTruncated).toBe(true);
      expect(result.estimatedTokens).toBeGreaterThan(6_000);
      expect(result.estimatedTokens).toBeLessThanOrEqual(8_000);
    });

    /** @scenario "A bounded digest spends the caller's budget, not the judge tool's" */
    it("never tells a reader without tools to call one", () => {
      const result = bounded(loop, 8_000);

      expect(result.text).not.toMatch(/grep_trace|expand_trace|\[TRUNCATED\]/);
    });
  });

  describe("given one span too large to expand whole", () => {
    /** @scenario "A bounded digest spends the caller's budget, not the judge tool's" */
    it("expands it keeping its opening and its ending", () => {
      const huge = span({
        spanId: "huge",
        name: "final-answer",
        type: "llm",
        text: `OPENING ${"filler words here ".repeat(4_000)} ENDING`,
      });

      const result = bounded([span({ spanId: "root", name: "root", text: "hi" }), huge], 2_000);

      expect(result.estimatedTokens).toBeLessThanOrEqual(2_000);
      expect(result.estimatedTokens).toBeGreaterThan(1_500);
      expect(result.text).toContain("OPENING");
      expect(result.text).toContain("ENDING");
      expect(result.text).toMatch(/tokens omitted from the middle/);
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

    /** @scenario "A structure too large for the budget is cut" */
    it("keeps the first and the last spans on whole lines, with a marker between them", () => {
      const spans = Array.from({ length: 200 }, (_, i) =>
        span({ spanId: `s${i}`, name: `step-number-${i}-with-a-long-name`, text: "x" }),
      );

      const result = bounded(spans, 400);

      expect(result.text).toContain("step-number-0-with-a-long-name");
      expect(result.text).toContain("step-number-199-with-a-long-name");
      expect(result.text).toMatch(/tokens omitted from the middle/);
      expect(result.text.split("\n").every((line) => !line.startsWith("-with-a-long-name"))).toBe(
        true,
      );
    });
  });
});
