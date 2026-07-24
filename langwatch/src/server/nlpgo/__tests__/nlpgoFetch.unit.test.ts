import { describe, expect, it } from "vitest";
import { formatTraceparent } from "../nlpgoFetch";

/**
 * Unit tests for the W3C traceparent header formatting in nlpgoFetch.
 *
 * Why this matters: nlpgoFetch is the dispatch boundary between TS
 * (eval-execution.service) and the nlpgo subprocess. Without a valid
 * `traceparent` header on the request, nlpgo's `startStudioSpan` cannot
 * extract a parent SpanContext and the eval workflow emits spans on a
 * brand-new trace_id — orphaned from the trace it was evaluating.
 *
 * This is the exact prod bug rchaves caught on 2026-05-14: the eval
 * ran, nlpgo emitted spans, but the spans landed under a separate
 * trace_id with no link back to the parent.
 *
 * These tests pin the wire-format contract so a future refactor can't
 * silently regress it.
 */
describe("nlpgoFetch.formatTraceparent", () => {
  /** @scenario formatTraceparent builds a valid W3C traceparent header */
  it("formats a valid W3C traceparent header", () => {
    const header = formatTraceparent({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      parentSpanId: "b7ad6b7169203331",
    });
    expect(header).toBe(
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    );
  });

  it("lowercases hex input so producers can pass either case", () => {
    const header = formatTraceparent({
      traceId: "0AF7651916CD43DD8448EB211C80319C",
      parentSpanId: "B7AD6B7169203331",
    });
    expect(header).toBe(
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    );
  });

  /** @scenario formatTraceparent rejects malformed traceId */
  it("rejects a traceId that is not 32 hex chars (loud failure beats silent broken header)", () => {
    expect(() =>
      formatTraceparent({
        traceId: "trace_legacy_format",
        parentSpanId: "b7ad6b7169203331",
      }),
    ).toThrow(/invalid traceId/);
  });

  /** @scenario formatTraceparent rejects malformed parentSpanId */
  it("rejects a parentSpanId that is not 16 hex chars", () => {
    expect(() =>
      formatTraceparent({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        parentSpanId: "not-16-hex",
      }),
    ).toThrow(/invalid parentSpanId/);
  });

  it("rejects non-hex characters disguised as right length", () => {
    expect(() =>
      formatTraceparent({
        traceId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
        parentSpanId: "b7ad6b7169203331",
      }),
    ).toThrow(/invalid traceId/);
  });
});
