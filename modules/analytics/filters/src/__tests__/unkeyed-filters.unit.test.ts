import { describe, expect, it } from "vitest";

import { findEvaluationFilterReferences, findUnkeyedFilterFields } from "../unkeyed-filters.ts";

describe("findUnkeyedFilterFields()", () => {
  describe("when a keyed field is written as a bare list", () => {
    /** @scenario "A keyed condition written without its key is refused" */
    it("names evaluations.passed and shows it keyed by a monitor", () => {
      const [unkeyed] = findUnkeyedFilterFields({ "evaluations.passed": ["false"] });
      expect(unkeyed?.field).toBe("evaluations.passed");
      expect(unkeyed?.example).toBe(
        JSON.stringify({ "evaluations.passed": { "<monitorId>": ["false"] } }),
      );
    });

    it("names metadata.value and shows it keyed by a metadata key", () => {
      const [unkeyed] = findUnkeyedFilterFields({ "metadata.value": ["prod"] });
      expect(unkeyed?.example).toBe(
        JSON.stringify({ "metadata.value": { "<metadataKey>": ["prod"] } }),
      );
    });
  });

  describe("when keyed fields carry their key", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({
          "evaluations.passed": { monitor_1: ["false"] },
          "metadata.value": { env: ["prod"] },
        }),
      ).toEqual([]);
    });
  });

  describe("when a field needs no key or a bare list is empty", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({ "traces.error": ["true"], "evaluations.passed": [] }),
      ).toEqual([]);
    });
  });
});

describe("findEvaluationFilterReferences()", () => {
  it("reads keyed evaluation fields by key and id lists by value", () => {
    expect(
      findEvaluationFilterReferences({
        "evaluations.passed": { monitor_1: ["true"] },
        "evaluations.evaluator_id": ["evaluator_2"],
        "traces.error": ["true"],
      }),
    ).toEqual([
      { field: "evaluations.passed", id: "monitor_1" },
      { field: "evaluations.evaluator_id", id: "evaluator_2" },
    ]);
  });
});
