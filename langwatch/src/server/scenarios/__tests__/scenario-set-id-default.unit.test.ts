/**
 * @vitest-environment node
 *
 * @see specs/scenarios/scenario-set-id-default.feature
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import {
  scenarioEventSchema,
  scenarioRunStartedSchema,
  scenarioMessageSnapshotSchema,
} from "~/server/scenarios/schemas/event-schemas";

const baseEvent = {
  type: ScenarioEventType.RUN_STARTED,
  timestamp: Date.now(),
  batchRunId: "batch_1",
  scenarioId: "scenario_1",
  scenarioRunId: "run_1",
  metadata: { name: "Test scenario" },
};

describe("scenarioSetId default", () => {
  describe("when scenarioSetId is omitted", () => {
    it("defaults to 'default'", () => {
      const result = scenarioEventSchema.safeParse(baseEvent);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when scenarioSetId is empty string", () => {
    it("coerces to 'default'", () => {
      const result = scenarioEventSchema.safeParse({
        ...baseEvent,
        scenarioSetId: "",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });

    it("coerces to 'default' via run started schema", () => {
      const result = scenarioRunStartedSchema.safeParse({
        ...baseEvent,
        scenarioSetId: "",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when scenarioSetId is a valid string", () => {
    it("preserves the value", () => {
      const result = scenarioEventSchema.safeParse({
        ...baseEvent,
        scenarioSetId: "my-set",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("my-set");
      }
    });
  });

  describe("all event types inherit the default", () => {
    it("defaults scenarioSetId on MESSAGE_SNAPSHOT events", () => {
      const result = scenarioMessageSnapshotSchema.safeParse({
        type: ScenarioEventType.MESSAGE_SNAPSHOT,
        timestamp: Date.now(),
        batchRunId: "batch_1",
        scenarioId: "scenario_1",
        scenarioRunId: "run_1",
        messages: [],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });
});
