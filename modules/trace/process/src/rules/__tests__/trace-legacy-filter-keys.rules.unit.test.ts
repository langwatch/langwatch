import { describe, expect, it } from "vitest";

import { findUnkeyedLegacyFilters } from "../trace-legacy-filter-keys.rules.ts";

const messageFor = (filters: Record<string, unknown>) =>
  findUnkeyedLegacyFilters({ filters, offersFilterString: true })[0]?.message ?? "";

describe("findUnkeyedLegacyFilters()", () => {
  describe("when a keyed filter carries its key", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedLegacyFilters({
          filters: { "evaluations.passed": { "evaluator-1": ["false"] } },
          offersFilterString: true,
        }),
      ).toEqual([]);
    });
  });

  describe("when a keyed filter is empty", () => {
    it("finds nothing, since an empty filter applies no condition", () => {
      expect(
        findUnkeyedLegacyFilters({
          filters: { "evaluations.passed": [], "metadata.value": {} },
          offersFilterString: true,
        }),
      ).toEqual([]);
    });
  });

  describe("when a keyed filter is a flat list", () => {
    it("names the field, its keyed shape and the filter-string form", () => {
      const [unkeyed] = findUnkeyedLegacyFilters({
        filters: { "evaluations.passed": ["false"] },
        offersFilterString: true,
      });
      expect(unkeyed?.field).toBe("filters.evaluations.passed");
      expect(unkeyed?.received).toEqual(["false"]);
      expect(unkeyed?.message).toContain('{"evaluations.passed":{"<monitorId>":["false"]}}');
      expect(unkeyed?.message).toContain("evaluatorVerdict:fail");
    });
  });

  describe("when a flat verdict list asks for passes", () => {
    it("points at the pass verdict, not the fail one", () => {
      const message = messageFor({ "evaluations.passed": ["true"] });
      expect(message).toContain("evaluatorVerdict:pass");
      expect(message).not.toContain("evaluatorVerdict:fail");
    });
  });

  describe("when a flat verdict list mixes verdicts", () => {
    it("offers no filter string, since none matches what was sent", () => {
      expect(messageFor({ "evaluations.passed": ["true", "false"] })).not.toContain(
        "evaluatorVerdict",
      );
    });
  });

  describe("when the route takes no filter string", () => {
    it("explains the keyed shape without pointing at one", () => {
      const [unkeyed] = findUnkeyedLegacyFilters({
        filters: { "evaluations.passed": ["false"] },
        offersFilterString: false,
      });
      expect(unkeyed?.message).toContain('{"evaluations.passed":{"<monitorId>":');
      expect(unkeyed?.message).not.toContain("evaluatorVerdict");
    });
  });

  describe("when the filters are absent or not a map", () => {
    it("finds nothing", () => {
      expect(findUnkeyedLegacyFilters({ filters: void 0, offersFilterString: true })).toEqual([]);
      expect(findUnkeyedLegacyFilters({ filters: ["x"], offersFilterString: true })).toEqual([]);
    });
  });
});
