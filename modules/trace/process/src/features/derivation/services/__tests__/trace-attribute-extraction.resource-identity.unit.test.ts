import { extractTraceSpanAttributes, type NormalizedSpan } from "@langwatch/trace-contract";
// @see specs/langy/langy-otel-tracing.feature
// OTLP exporters set reserved keys via RESOURCE attributes, must hoist from
// resource same way as from span attributes
import { describe, expect, it } from "vitest";

function makeSpan(
  overrides: Partial<Pick<NormalizedSpan, "spanAttributes" | "resourceAttributes">> = {},
): NormalizedSpan {
  return {
    spanAttributes: {},
    resourceAttributes: {},
    ...overrides,
  } as NormalizedSpan;
}

describe("extractTraceSpanAttributes and resource attributes", () => {
  describe("when a resource carries tag.tags", () => {
    /** @scenario "tag.tags in resource attributes becomes trace labels" */
    it("maps it to langwatch.labels", () => {
      const result = extractTraceSpanAttributes(
        makeSpan({ resourceAttributes: { "tag.tags": "checkout-flow" } }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual(["checkout-flow"]);
    });
  });

  describe("when a resource carries langwatch.thread.id", () => {
    /** @scenario "langwatch.thread.id in resource attributes becomes thread_id" */
    it("maps it to gen_ai.conversation.id", () => {
      const result = extractTraceSpanAttributes(
        makeSpan({ resourceAttributes: { "langwatch.thread.id": "conv-123" } }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("conv-123");
    });
  });
});
