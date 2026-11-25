import { describe, expect, it } from "vitest";

import { unkeyedLegacyFilterViolations } from "../trace-legacy-filter-keys.rules.ts";

const withFilterString = (filters: Record<string, unknown>) =>
  unkeyedLegacyFilterViolations({ filters, offersFilterString: true });

describe("unkeyedLegacyFilterViolations()", () => {
  describe("when a keyed filter carries its key", () => {
    it("finds nothing", () => {
      expect(withFilterString({ "evaluations.passed": { "evaluator-1": ["false"] } })).toEqual([]);
    });
  });

  describe("when a keyed filter is empty", () => {
    it("finds nothing, since an empty filter applies no condition", () => {
      expect(withFilterString({ "evaluations.passed": [], "metadata.value": {} })).toEqual([]);
    });
  });

  describe("when a keyed filter is a flat list", () => {
    it("names the field, the keyed shape and the filter-string form", () => {
      const [violation, ...rest] = withFilterString({ "evaluations.passed": ["false"] });
      expect(rest).toEqual([]);
      expect(violation?.field).toBe("filters.evaluations.passed");
      expect(violation?.type).toBe("filter_key_required");
      expect(violation?.received).toEqual(["false"]);
      expect(violation?.message).toContain("evaluatorVerdict:fail");
      expect(violation?.message).toContain('{"evaluations.passed":{"<monitorId>":["false"]}}');
    });
  });

  describe("when a flat verdict list asks for passes", () => {
    it("points at the pass verdict, not the fail one", () => {
      const [violation] = withFilterString({ "evaluations.passed": ["true"] });
      expect(violation?.message).toContain("evaluatorVerdict:pass");
      expect(violation?.message).not.toContain("evaluatorVerdict:fail");
    });
  });

  describe("when a flat verdict list mixes verdicts", () => {
    it("offers no filter string, since none matches what was sent", () => {
      const [violation] = withFilterString({ "evaluations.passed": ["true", "false"] });
      expect(violation?.message).not.toContain("evaluatorVerdict");
    });
  });

  describe("when a filter needing a key and a subkey has only the key", () => {
    it("names it", () => {
      const violations = unkeyedLegacyFilterViolations({
        filters: { "events.metrics.value": { thumbs_up_down: ["1", "1"] } },
        offersFilterString: false,
      });
      expect(violations.map((violation) => violation.field)).toEqual([
        "filters.events.metrics.value",
      ]);
    });
  });

  describe("when a filter needing a key and a subkey has both", () => {
    it("finds nothing", () => {
      const violations = unkeyedLegacyFilterViolations({
        filters: { "events.metrics.value": { thumbs_up_down: { vote: ["1", "1"] } } },
        offersFilterString: false,
      });
      expect(violations).toEqual([]);
    });
  });

  describe("when a filter needs no key", () => {
    it("finds nothing in a flat list", () => {
      expect(withFilterString({ "traces.error": ["true"] })).toEqual([]);
    });
  });

  describe("when the route has no filter string", () => {
    it("explains the keyed shape without pointing at a filter string", () => {
      const [violation] = unkeyedLegacyFilterViolations({
        filters: { "evaluations.passed": ["false"] },
        offersFilterString: false,
      });
      expect(violation?.message).toContain('{"evaluations.passed":{"<monitorId>":');
      expect(violation?.message).not.toContain("evaluatorVerdict");
    });
  });

  describe("when there are no filters", () => {
    it("finds nothing", () => {
      expect(
        unkeyedLegacyFilterViolations({ filters: undefined, offersFilterString: true }),
      ).toEqual([]);
    });
  });
});
