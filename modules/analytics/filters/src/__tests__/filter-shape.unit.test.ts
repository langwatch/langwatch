import { describe, expect, it } from "vitest";

import { findUnkeyedFilterFields } from "../filter-shape.ts";

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

  describe("when a field needing a key and a subkey has only the key", () => {
    it("names it", () => {
      const [unkeyed] = findUnkeyedFilterFields({
        "events.metrics.value": { thumbs_up_down: ["1"] },
      });
      expect(unkeyed?.field).toBe("events.metrics.value");
    });
  });

  describe("when keyed fields carry their key", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({
          "evaluations.passed": { monitor_1: ["false"] },
          "metadata.value": { env: ["prod"] },
          "events.metrics.value": { thumbs_up_down: { vote: ["1"] } },
        }),
      ).toEqual([]);
    });
  });

  describe("when a field needs no key or a keyed field is empty", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({
          "traces.error": ["true"],
          "evaluations.passed": [],
          "metadata.value": {},
        }),
      ).toEqual([]);
    });
  });
});
