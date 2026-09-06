import { describe, expect, it } from "vitest";
import { runtimeParametersSchema } from "~/prompts/schemas/field-schemas";

describe("runtimeParametersSchema", () => {
  describe("when validating valid configs", () => {
    it("accepts an empty object", () => {
      const result = runtimeParametersSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it("accepts flat key-value pairs", () => {
      const config = { search_iterations: 3, confidence_threshold: 0.85 };
      const result = runtimeParametersSchema.safeParse(config);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(config);
    });

    it("accepts deeply nested objects", () => {
      const config = {
        a: { b: { c: [1, 2, { d: true }] } },
        output_schema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      };
      const result = runtimeParametersSchema.safeParse(config);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(config);
    });

    it("accepts mixed value types in an object", () => {
      const config = {
        max_retries: 5,
        enabled: true,
        tags: ["v1", "beta"],
        label: "production",
        threshold: null,
      };
      const result = runtimeParametersSchema.safeParse(config);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(config);
    });

    it("defaults to empty object when undefined", () => {
      const result = runtimeParametersSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });
  });

  describe("when validating invalid configs", () => {
    it("rejects an array at root", () => {
      const result = runtimeParametersSchema.safeParse([1, 2, 3]);
      expect(result.success).toBe(false);
    });

    it("rejects a string at root", () => {
      const result = runtimeParametersSchema.safeParse("hello");
      expect(result.success).toBe(false);
    });

    it("rejects a number at root", () => {
      const result = runtimeParametersSchema.safeParse(42);
      expect(result.success).toBe(false);
    });

    it("rejects a boolean at root", () => {
      const result = runtimeParametersSchema.safeParse(true);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = runtimeParametersSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });
});
