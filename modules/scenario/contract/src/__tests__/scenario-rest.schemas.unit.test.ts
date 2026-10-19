/**
 * The wire schemas of the scenarios REST family.
 */

import { describe, expect, it } from "vitest";

import { scenarioRestUpdateSchema } from "../scenario-rest.schemas.ts";

describe("scenarioRestUpdateSchema", () => {
  describe("when the body carries a field the endpoint does not have", () => {
    it("refuses it by name instead of dropping it", () => {
      const result = scenarioRestUpdateSchema.safeParse({ labels: ["a"], status: "active" });

      expect(result.success).toBe(false);
      const issue = result.error?.issues.find((one) => one.code === "unrecognized_keys");
      expect(issue).toMatchObject({ keys: ["status"] });
    });
  });

  describe("when the body carries only fields the endpoint has", () => {
    it("accepts a partial update", () => {
      expect(scenarioRestUpdateSchema.validate({ name: "Renamed", maxTurns: null })).toBe(true);
    });
  });
});
