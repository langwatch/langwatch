/**
 * @see specs/langy/langy-otel-tracing.feature
 * OTLP exporters (the Langy worker relay among them) set reserved keys via RESOURCE attributes rather than span attributes, so they must be hoisted from the resource the same way they are from span attributes.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "@langwatch/trace-contract";

import { TraceAttributeExtractionService } from "../trace-attribute-extraction.service";

function makeService() {
  return TraceAttributeExtractionService.create();
}

function makeSpan(
  overrides: Partial<Pick<NormalizedSpan, "spanAttributes" | "resourceAttributes">> = {},
): NormalizedSpan {
  return {
    spanAttributes: {},
    resourceAttributes: {},
    ...overrides,
  } as NormalizedSpan;
}

describe("TraceAttributeExtractionService.extractAttributes and resource attributes", () => {
  describe("when a resource carries tag.tags", () => {
    /** @scenario "tag.tags in resource attributes becomes trace labels" */
    it("maps it to langwatch.labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({ resourceAttributes: { "tag.tags": "checkout-flow" } }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual(["checkout-flow"]);
    });
  });

  describe("when a resource carries langwatch.thread.id", () => {
    /** @scenario "langwatch.thread.id in resource attributes becomes thread_id" */
    it("maps it to gen_ai.conversation.id", () => {
      const result = makeService().extractAttributes(
        makeSpan({ resourceAttributes: { "langwatch.thread.id": "conv-123" } }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("conv-123");
    });
  });
});
