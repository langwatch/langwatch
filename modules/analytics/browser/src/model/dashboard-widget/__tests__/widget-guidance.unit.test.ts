/**
 * An empty widget names what sends its data: the SDK call, setting or integration.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { describe, expect, it } from "vitest";

import { missingFieldGuidance, noTrafficGuidance } from "../widget-guidance.ts";

describe("missingFieldGuidance", () => {
  describe("given a trace field with words of its own", () => {
    /** @scenario "An empty widget names what sends its data" */
    it("names the metadata key the SDK sends it in", () => {
      expect(missingFieldGuidance({ field: "UserId", label: "user", unit: "traces" })).toBe(
        "Send user_id in the trace metadata with the LangWatch SDK.",
      );
      expect(
        missingFieldGuidance({ field: "ConversationId", label: "conversation", unit: "traces" }),
      ).toBe("Send thread_id in the trace metadata with the LangWatch SDK.");
    });

    /** @scenario "An empty widget names what sends its data" */
    it("names the model, the token counts and a model price for total cost", () => {
      const line = missingFieldGuidance({
        field: "TotalCost",
        label: "total cost",
        unit: "traces",
      });
      expect(line).toContain("model name and token counts");
      expect(line).toContain("price for your model in Settings");
    });
  });

  describe("given a trace field with no words of its own", () => {
    /** @scenario "An empty widget names what sends its data" */
    it("says to send it on the traces with the SDK", () => {
      expect(
        missingFieldGuidance({
          field: "TimeToFirstTokenMs",
          label: "time to first token",
          unit: "traces",
        }),
      ).toBe("Send time to first token on your traces with the LangWatch SDK.");
    });
  });

  describe("given a field of an evaluation", () => {
    /** @scenario "An empty widget names what sends its data" */
    it("says evaluations come from evaluators", () => {
      expect(missingFieldGuidance({ field: "Score", label: "score", unit: "evaluations" })).toBe(
        "Evaluations come from the evaluators you run on your traces.",
      );
    });
  });

  describe("given a unit with no words of its own", () => {
    it("has no line, so the card adds none", () => {
      expect(
        missingFieldGuidance({ field: "Foo", label: "foo", unit: "sessions" }),
      ).toBeUndefined();
    });
  });
});

describe("noTrafficGuidance", () => {
  describe("given traces in a project that never received one", () => {
    /** @scenario "An empty widget names what sends its data" */
    it("says to send traces with the SDK and offers to set up tracing", () => {
      expect(noTrafficGuidance({ unit: "traces", awaitsFirstTrace: true })).toEqual({
        line: "Send traces with the LangWatch SDK to fill this widget.",
        action: { label: "Set up tracing", target: "traces" },
      });
    });
  });

  describe("given traces in a project that has received some", () => {
    it("says nothing more, since the period is only quiet", () => {
      expect(noTrafficGuidance({ unit: "traces", awaitsFirstTrace: false })).toBeUndefined();
    });
  });

  describe("given evaluations", () => {
    /** @scenario "An empty widget names what sends its data" */
    it("says where evaluations come from, with no setup step", () => {
      expect(noTrafficGuidance({ unit: "evaluations", awaitsFirstTrace: false })).toEqual({
        line: "Evaluations come from the evaluators you run on your traces.",
      });
    });
  });
});
