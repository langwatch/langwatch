/**
 * @vitest-environment node
 *
 * Regression test for issue #2596:
 * Empty string scenarioSetId must be coerced to "default", never rejected.
 * Rejecting events loses data — we always accept and normalize.
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import {
  scenarioEventSchema,
  scenarioRunStartedSchema,
} from "~/server/scenarios/schemas/event-schemas";

const validEvent = {
  type: ScenarioEventType.RUN_STARTED,
  timestamp: Date.now(),
  batchRunId: "batch_1",
  scenarioId: "scenario_1",
  scenarioRunId: "run_1",
  metadata: { name: "Test scenario" },
};

describe("scenarioSetId empty string handling", () => {
  describe("when scenarioSetId is an empty string", () => {
    it("coerces to 'default' via discriminated union schema", () => {
      const event = { ...validEvent, scenarioSetId: "" };

      const result = scenarioEventSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });

    it("coerces to 'default' via run started schema", () => {
      const event = { ...validEvent, scenarioSetId: "" };

      const result = scenarioRunStartedSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when scenarioSetId is omitted", () => {
    it("defaults to 'default'", () => {
      const event = { ...validEvent };

      const result = scenarioEventSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when scenarioSetId is a valid non-empty string", () => {
    it("preserves the value", () => {
      const event = { ...validEvent, scenarioSetId: "my-set" };

      const result = scenarioEventSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("my-set");
      }
    });
  });
});
