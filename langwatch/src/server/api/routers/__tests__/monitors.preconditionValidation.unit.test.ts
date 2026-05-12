import { describe, expect, it } from "vitest";
import { validatedPreconditionsSchema } from "../../../evaluations/preconditionValidation";

describe("validatedPreconditionsSchema", () => {
  describe("when rule is allowed for field", () => {
    it("accepts input with contains rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "input", rule: "contains", value: "hello" },
      ]);
      expect(result.success).toBe(true);
    });

    it("accepts traces.origin with is rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "traces.origin", rule: "is", value: "application" },
      ]);
      expect(result.success).toBe(true);
    });

    it("accepts traces.error with is rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "traces.error", rule: "is", value: "true" },
      ]);
      expect(result.success).toBe(true);
    });

    it("accepts multiple valid preconditions", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "traces.origin", rule: "is", value: "application" },
        { field: "input", rule: "contains", value: "test" },
        { field: "metadata.labels", rule: "is", value: "production" },
      ]);
      expect(result.success).toBe(true);
    });

    it("accepts empty preconditions array", () => {
      const result = validatedPreconditionsSchema.safeParse([]);
      expect(result.success).toBe(true);
    });
  });

  describe("when rule is not allowed for field", () => {
    it("rejects traces.origin with contains rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "traces.origin", rule: "contains", value: "app" },
      ]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'Rule "contains" is not allowed for field "traces.origin"',
        );
        expect(result.error.issues[0]?.path).toEqual([0, "rule"]);
      }
    });

    it("rejects traces.error with matches_regex rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "traces.error", rule: "matches_regex", value: ".*" },
      ]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'Rule "matches_regex" is not allowed for field "traces.error"',
        );
      }
    });

    it("rejects spans.type with not_contains rule", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "spans.type", rule: "not_contains", value: "llm" },
      ]);
      expect(result.success).toBe(false);
    });

    it("reports correct index path for invalid precondition in array", () => {
      const result = validatedPreconditionsSchema.safeParse([
        { field: "input", rule: "contains", value: "valid" },
        { field: "spans.model", rule: "matches_regex", value: "gpt.*" },
      ]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual([1, "rule"]);
      }
    });
  });
});
