import { describe, expect, it } from "vitest";
import { runtimeConfigSchema } from "~/prompts/schemas/field-schemas";

describe("runtimeConfigSchema", () => {
  describe("when validating valid configs", () => {
    it("accepts an empty object", () => {
      const result = runtimeConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it("accepts flat key-value pairs", () => {
      const config = { search_iterations: 3, confidence_threshold: 0.85 };
      const result = runtimeConfigSchema.safeParse(config);
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
      const result = runtimeConfigSchema.safeParse(config);
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
      const result = runtimeConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(config);
    });

    it("defaults to empty object when undefined", () => {
      const result = runtimeConfigSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });
  });

  describe("when validating invalid configs", () => {
    it("rejects an array at root", () => {
      const result = runtimeConfigSchema.safeParse([1, 2, 3]);
      expect(result.success).toBe(false);
    });

    it("rejects a string at root", () => {
      const result = runtimeConfigSchema.safeParse("hello");
      expect(result.success).toBe(false);
    });

    it("rejects a number at root", () => {
      const result = runtimeConfigSchema.safeParse(42);
      expect(result.success).toBe(false);
    });

    it("rejects a boolean at root", () => {
      const result = runtimeConfigSchema.safeParse(true);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = runtimeConfigSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });
});
