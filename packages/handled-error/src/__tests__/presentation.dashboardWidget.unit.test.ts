import { explainHandledError } from "@langwatch/handled-error/presentation";
import type { HandledErrorShape } from "@langwatch/handled-error/read-handled-error";
/**
 * A widget that starts more queries at once than the frame allows is refused with a code of its
 * own, so a reader needs words for it: an empty description leaves the line saying nothing.
 */
import { describe, expect, it } from "vitest";

const overloaded: HandledErrorShape = {
  code: "dashboard_widget_query_overloaded",
  meta: {},
  httpStatus: 429,
  fault: "customer",
  retryable: true,
  tips: [],
  docsUrl: undefined,
  traceId: undefined,
  reasons: [],
};

describe("given a widget that ran too many queries at once", () => {
  describe("when its refusal is worded", () => {
    /** @scenario A widget that runs too many queries at once is told why */
    it("has a registered title and a sentence saying the extra query was not started", () => {
      const copy = explainHandledError(overloaded);

      expect(copy.isRegistered).toBe(true);
      expect(copy.title).not.toBe("");
      expect(copy.description).toMatch(/not started/i);
      expect(`${copy.title} ${copy.description}`).not.toContain(
        "dashboard_widget_query_overloaded",
      );
    });
  });
});
