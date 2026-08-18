/**
 * @vitest-environment node
 *
 * Unit tests for the scenario create/update input schemas. The tRPC schema
 * is the only line enforcing the turn cap bounds (the service below it is a
 * pass-through), so the bounds are pinned here.
 *
 * @see specs/scenarios/scenario-max-turns.feature
 */
import { describe, expect, it } from "vitest";

import {
  createScenarioSchema,
  updateScenarioSchema,
} from "../scenario-crud.router";

const baseCreateInput = {
  projectId: "proj_1",
  name: "Refund flow",
  situation: "User asks for a refund",
  criteria: ["Agent is polite"],
  labels: [],
};

const baseUpdateInput = {
  projectId: "proj_1",
  id: "scen_1",
};

describe("scenario create/update input schemas", () => {
  describe("given a maximum turns value out of bounds", () => {
    /** @scenario "The scenario form rejects an out-of-bounds maximum turns" */
    it.each([0, 51])("rejects %s on create", (maxTurns) => {
      const result = createScenarioSchema.safeParse({
        ...baseCreateInput,
        maxTurns,
      });
      expect(result.success).toBe(false);
    });

    /** @scenario "The scenario form rejects an out-of-bounds maximum turns" */
    it.each([0, 51])("rejects %s on update", (maxTurns) => {
      const result = updateScenarioSchema.safeParse({
        ...baseUpdateInput,
        maxTurns,
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-integer value on create", () => {
      const result = createScenarioSchema.safeParse({
        ...baseCreateInput,
        maxTurns: 2.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("given a maximum turns value within bounds", () => {
    /** @scenario "The turn cap persists on scenario create and update" */
    it.each([1, 50])("accepts %s on create", (maxTurns) => {
      const result = createScenarioSchema.safeParse({
        ...baseCreateInput,
        maxTurns,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBe(maxTurns);
      }
    });

    /** @scenario "The turn cap persists on scenario create and update" */
    it.each([1, 50])("accepts %s on update", (maxTurns) => {
      const result = updateScenarioSchema.safeParse({
        ...baseUpdateInput,
        maxTurns,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBe(maxTurns);
      }
    });
  });

  describe("given no maximum turns value", () => {
    it("accepts null on create, meaning clear back to the default", () => {
      const result = createScenarioSchema.safeParse({
        ...baseCreateInput,
        maxTurns: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBeNull();
      }
    });

    it("accepts null on update, meaning clear back to the default", () => {
      const result = updateScenarioSchema.safeParse({
        ...baseUpdateInput,
        maxTurns: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBeNull();
      }
    });

    it("accepts an absent field on create", () => {
      const result = createScenarioSchema.safeParse(baseCreateInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBeUndefined();
      }
    });

    it("accepts an absent field on update", () => {
      const result = updateScenarioSchema.safeParse(baseUpdateInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBeUndefined();
      }
    });
  });
});
