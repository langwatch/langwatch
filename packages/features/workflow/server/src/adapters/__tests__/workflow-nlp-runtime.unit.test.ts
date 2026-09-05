import { describe, expect, it } from "vitest";
import { HttpWorkflowNlpRuntimeAdapter } from "../workflow-nlp-runtime.adapter";

/**
 * Unit tests for the W3C traceparent header formatting in nlpgoFetch. Why this matters: the NLP
 * runtime adapter is the dispatch boundary between TS (eval-execution.service) and the nlpgo
 * subprocess.
 */
describe("formatTraceparent", () => {
  /** @scenario formatTraceparent builds a valid W3C traceparent header */
  it("formats a valid W3C traceparent header", () => {
    const header = HttpWorkflowNlpRuntimeAdapter.formatTraceparent({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      parentSpanId: "b7ad6b7169203331",
    });
    expect(header).toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
  });

  it("lowercases hex input so producers can pass either case", () => {
    const header = HttpWorkflowNlpRuntimeAdapter.formatTraceparent({
      traceId: "0AF7651916CD43DD8448EB211C80319C",
      parentSpanId: "B7AD6B7169203331",
    });
    expect(header).toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
  });

  /** @scenario formatTraceparent rejects malformed traceId */
  it("rejects a traceId that is not 32 hex chars (loud failure beats silent broken header)", () => {
    expect(() =>
      HttpWorkflowNlpRuntimeAdapter.formatTraceparent({
        traceId: "trace_legacy_format",
        parentSpanId: "b7ad6b7169203331",
      }),
    ).toThrow(/invalid traceId/);
  });

  /** @scenario formatTraceparent rejects malformed parentSpanId */
  it("rejects a parentSpanId that is not 16 hex chars", () => {
    expect(() =>
      HttpWorkflowNlpRuntimeAdapter.formatTraceparent({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        parentSpanId: "not-16-hex",
      }),
    ).toThrow(/invalid parentSpanId/);
  });

  it("rejects non-hex characters disguised as right length", () => {
    expect(() =>
      HttpWorkflowNlpRuntimeAdapter.formatTraceparent({
        traceId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
        parentSpanId: "b7ad6b7169203331",
      }),
    ).toThrow(/invalid traceId/);
  });
});
