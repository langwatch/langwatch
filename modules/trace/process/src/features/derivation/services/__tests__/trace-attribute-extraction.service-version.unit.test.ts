/**
 * The application version reaches the trace's attribute map, where the analytics fold reads it.
 * @see specs/lwql/release-check-reads-releases.feature
 */
import { extractTraceSpanAttributes, type NormalizedSpan } from "@langwatch/trace-contract";
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

describe("extractTraceSpanAttributes and the application version", () => {
  describe("when the resource carries service.version", () => {
    /** @scenario "The resource's service.version reaches the trace's attributes" */
    it("keeps it as the trace's service.version", () => {
      const result = extractTraceSpanAttributes(
        makeSpan({
          resourceAttributes: { "service.name": "support-agent", "service.version": "v14.1" },
        }),
      );

      expect(result["service.version"]).toBe("v14.1");
    });
  });

  describe("when a span carries service.version as its own attribute", () => {
    it("keeps it as the trace's service.version", () => {
      const result = extractTraceSpanAttributes(
        makeSpan({ spanAttributes: { "service.version": "1.2.3" } }),
      );

      expect(result["service.version"]).toBe("1.2.3");
    });
  });

  describe("when no version is sent", () => {
    it("adds no service.version", () => {
      const result = extractTraceSpanAttributes(
        makeSpan({ resourceAttributes: { "service.name": "support-agent" } }),
      );

      expect(result).not.toHaveProperty("service.version");
    });
  });
});
