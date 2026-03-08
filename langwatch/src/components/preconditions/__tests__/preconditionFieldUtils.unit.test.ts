import { describe, expect, it } from "vitest";
import {
  getAllowedRulesForField,
  getFieldOptionsByCategory,
  getFieldValueType,
  isDefaultOnlyPrecondition,
  isRuleAllowedForField,
  RULE_LABELS,
  DEFAULT_PRECONDITION,
} from "../preconditionFieldUtils";

describe("preconditionFieldUtils", () => {
  describe("RULE_LABELS", () => {
    it("maps all 4 rules to human-readable labels", () => {
      expect(RULE_LABELS.contains).toBe("contains");
      expect(RULE_LABELS.not_contains).toBe("does not contain");
      expect(RULE_LABELS.matches_regex).toBe("matches regex");
      expect(RULE_LABELS.is).toBe("is");
    });
  });

  describe("getFieldOptionsByCategory()", () => {
    it("returns fields grouped into 3 categories", () => {
      const groups = getFieldOptionsByCategory();
      const categoryNames = groups.map((g) => g.category);
      expect(categoryNames).toContain("Trace");
      expect(categoryNames).toContain("Metadata");
      expect(categoryNames).toContain("Spans");
    });

    it("returns all 11 fields across all groups", () => {
      const groups = getFieldOptionsByCategory();
      const totalFields = groups.reduce(
        (sum, g) => sum + g.fields.length,
        0,
      );
      expect(totalFields).toBe(11);
    });

    it("places input and output in Trace category", () => {
      const groups = getFieldOptionsByCategory();
      const traceGroup = groups.find((g) => g.category === "Trace");
      const traceFieldValues = traceGroup?.fields.map((f) => f.value) ?? [];
      expect(traceFieldValues).toContain("input");
      expect(traceFieldValues).toContain("output");
    });

    it("places metadata fields in Metadata category", () => {
      const groups = getFieldOptionsByCategory();
      const metaGroup = groups.find((g) => g.category === "Metadata");
      const metaFieldValues = metaGroup?.fields.map((f) => f.value) ?? [];
      expect(metaFieldValues).toContain("metadata.labels");
      expect(metaFieldValues).toContain("metadata.user_id");
    });

    it("places span fields in Spans category", () => {
      const groups = getFieldOptionsByCategory();
      const spansGroup = groups.find((g) => g.category === "Spans");
      const spanFieldValues = spansGroup?.fields.map((f) => f.value) ?? [];
      expect(spanFieldValues).toContain("spans.type");
      expect(spanFieldValues).toContain("spans.model");
    });
  });

  describe("getAllowedRulesForField()", () => {
    it("returns all 4 rules for text fields like input", () => {
      const rules = getAllowedRulesForField("input");
      expect(rules).toEqual(["contains", "not_contains", "matches_regex", "is"]);
    });

    it("returns only 'is' for enum fields like traces.origin", () => {
      const rules = getAllowedRulesForField("traces.origin");
      expect(rules).toEqual(["is"]);
    });

    it("returns only 'is' for boolean fields like traces.error", () => {
      const rules = getAllowedRulesForField("traces.error");
      expect(rules).toEqual(["is"]);
    });

    it("returns subset of rules for array fields like metadata.labels", () => {
      const rules = getAllowedRulesForField("metadata.labels");
      expect(rules).toEqual(["is", "contains", "not_contains"]);
    });
  });

  describe("getFieldValueType()", () => {
    it("returns 'text' for input field", () => {
      expect(getFieldValueType("input")).toBe("text");
    });

    it("returns 'boolean' for traces.error", () => {
      expect(getFieldValueType("traces.error")).toBe("boolean");
    });

    it("returns 'enum' for traces.origin", () => {
      expect(getFieldValueType("traces.origin")).toBe("enum");
    });

    it("returns 'span-lookup' for spans.model", () => {
      expect(getFieldValueType("spans.model")).toBe("span-lookup");
    });
  });

  describe("isRuleAllowedForField()", () => {
    it("returns true for valid rule-field combination", () => {
      expect(isRuleAllowedForField("input", "contains")).toBe(true);
    });

    it("returns false for invalid rule-field combination", () => {
      expect(isRuleAllowedForField("traces.origin", "contains")).toBe(false);
    });

    it("returns false for unknown field", () => {
      expect(
        isRuleAllowedForField("unknown.field" as any, "is"),
      ).toBe(false);
    });
  });

  describe("isDefaultOnlyPrecondition()", () => {
    it("returns true for single origin=application precondition", () => {
      expect(
        isDefaultOnlyPrecondition([
          { field: "traces.origin", rule: "is", value: "application" },
        ]),
      ).toBe(true);
    });

    it("returns false for empty preconditions", () => {
      expect(isDefaultOnlyPrecondition([])).toBe(false);
    });

    it("returns false when multiple preconditions exist", () => {
      expect(
        isDefaultOnlyPrecondition([
          { field: "traces.origin", rule: "is", value: "application" },
          { field: "input", rule: "contains", value: "hello" },
        ]),
      ).toBe(false);
    });

    it("returns false when single precondition is not the default", () => {
      expect(
        isDefaultOnlyPrecondition([
          { field: "input", rule: "contains", value: "test" },
        ]),
      ).toBe(false);
    });

    it("returns false when origin precondition has different value", () => {
      expect(
        isDefaultOnlyPrecondition([
          { field: "traces.origin", rule: "is", value: "playground" },
        ]),
      ).toBe(false);
    });
  });

  describe("DEFAULT_PRECONDITION", () => {
    it("has the expected shape", () => {
      expect(DEFAULT_PRECONDITION).toEqual({
        field: "traces.origin",
        rule: "is",
        value: "application",
      });
    });
  });
});
