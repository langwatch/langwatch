/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-set-id-default.feature
 */
import { describe, expect, it } from "vitest";
import {
  ScenarioEventType,
  scenarioMessageSnapshotSchema,
  scenarioRunStartedSchema,
} from "../index";

function runStartedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: ScenarioEventType.RUN_STARTED,
    timestamp: Date.now(),
    batchRunId: "batch-1",
    scenarioId: "scenario-1",
    scenarioRunId: "run-1",
    metadata: {},
    ...overrides,
  };
}

describe("scenarioSetId defaults to \"default\" on ingestion", () => {
  describe("when a RUN_STARTED event has no scenarioSetId field", () => {
    /** @scenario scenarioSetId omitted from event */
    it("is accepted, with scenarioSetId set to \"default\"", () => {
      const result = scenarioRunStartedSchema.safeParse(runStartedEvent());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when a RUN_STARTED event has scenarioSetId \"\"", () => {
    /** @scenario scenarioSetId is empty string */
    it("is accepted, with scenarioSetId coerced to \"default\"", () => {
      const result = scenarioRunStartedSchema.safeParse(
        runStartedEvent({ scenarioSetId: "" }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when a RUN_STARTED event has scenarioSetId \"my-set\"", () => {
    /** @scenario scenarioSetId is a valid string */
    it("is accepted, with scenarioSetId \"my-set\"", () => {
      const result = scenarioRunStartedSchema.safeParse(
        runStartedEvent({ scenarioSetId: "my-set" }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("my-set");
      }
    });
  });

  describe("when a MESSAGE_SNAPSHOT event has no scenarioSetId field", () => {
    /** @scenario MESSAGE_SNAPSHOT event omits scenarioSetId */
    it("has scenarioSetId set to \"default\"", () => {
      const result = scenarioMessageSnapshotSchema.safeParse({
        type: ScenarioEventType.MESSAGE_SNAPSHOT,
        timestamp: Date.now(),
        batchRunId: "batch-1",
        scenarioId: "scenario-1",
        scenarioRunId: "run-1",
        messages: [],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });

  describe("when the API dispatches a RUN_STARTED event to ClickHouse with scenarioSetId \"\"", () => {
    /** @scenario runtime fallback in ClickHouse dispatch */
    it("carries scenarioSetId \"default\" on the parsed event the dispatch reads from", () => {
      // The dispatch command reads scenarioSetId off the already-parsed event,
      // so the schema's own coercion IS the runtime fallback: nothing
      // downstream re-derives it.
      const result = scenarioRunStartedSchema.safeParse(
        runStartedEvent({ scenarioSetId: "" }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioSetId).toBe("default");
      }
    });
  });
});
