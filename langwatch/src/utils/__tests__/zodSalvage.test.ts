import { describe, expect, it } from "vitest";
import { z } from "zod";

import { salvageValidData } from "../zodSalvage";

describe("salvageValidData", () => {
  const testSchema = z.object({
    name: z.string().default("default-name"),
    age: z.number().default(0),
    email: z.string().email().default("default@example.com"),
    nested: z
      .object({
        foo: z.string().default("default-foo"),
        bar: z.number().default(42),
      })
      .default({ foo: "default-foo", bar: 42 }),
  });

  describe("when data is fully valid", () => {
    it("returns the data as-is", () => {
      const validData = {
        name: "John",
        age: 30,
        email: "john@example.com",
        nested: { foo: "hello", bar: 100 },
      };

      const result = salvageValidData(testSchema, validData);

      expect(result).toEqual(validData);
    });
  });

  describe("when data is partially valid", () => {
    it("salvages valid fields and uses defaults for invalid fields", () => {
      const partiallyValid = {
        name: "John",
        age: "not-a-number", // Invalid
        email: "john@example.com",
        nested: { foo: "hello", bar: 100 },
      };

      const result = salvageValidData(testSchema, partiallyValid);

      expect(result.name).toBe("John");
      expect(result.age).toBe(0); // Default
      expect(result.email).toBe("john@example.com");
      expect(result.nested).toEqual({ foo: "hello", bar: 100 });
    });
  });

  describe("when nested object is partially valid", () => {
    it("recursively salvages nested fields", () => {
      const nestedPartiallyValid = {
        name: "John",
        age: 30,
        email: "john@example.com",
        nested: { foo: "hello", bar: "not-a-number" }, // bar is invalid
      };

      const result = salvageValidData(testSchema, nestedPartiallyValid);

      expect(result.name).toBe("John");
      expect(result.age).toBe(30);
      expect(result.email).toBe("john@example.com");
      expect(result.nested.foo).toBe("hello");
      expect(result.nested.bar).toBe(42); // Default
    });
  });

  describe("when data is completely invalid", () => {
    it("returns schema defaults", () => {
      const invalidData = {
        name: 123, // Invalid
        age: "not-a-number", // Invalid
        email: "not-an-email", // Invalid
        nested: "not-an-object", // Invalid
      };

      const result = salvageValidData(testSchema, invalidData);

      expect(result.name).toBe("default-name");
      expect(result.age).toBe(0);
      expect(result.email).toBe("default@example.com");
      expect(result.nested).toEqual({ foo: "default-foo", bar: 42 });
    });
  });

  describe("when data is null or undefined", () => {
    it("returns schema defaults", () => {
      const resultNull = salvageValidData(testSchema, null);
      const resultUndefined = salvageValidData(testSchema, undefined);

      expect(resultNull.name).toBe("default-name");
      expect(resultUndefined.name).toBe("default-name");
    });
  });

  describe("when data has extra keys", () => {
    it("ignores keys not in schema", () => {
      const dataWithExtra = {
        name: "John",
        age: 30,
        email: "john@example.com",
        nested: { foo: "hello", bar: 100 },
        extraKey: "should be ignored",
      };

      const result = salvageValidData(testSchema, dataWithExtra);

      expect("extraKey" in result).toBe(false);
    });
  });

  describe("when optional nested object has corrupted data", () => {
    it("handles optional nested objects gracefully without crashing", () => {
      const optionalNestedSchema = z.object({
        name: z.string().default("default-name"),
        optional: z
          .object({
            required: z.string(),
            other: z.number().default(0),
          })
          .optional(),
      });

      const corruptedOptionalNested = {
        name: "John",
        optional: { required: "valid", other: "not-a-number" }, // other is invalid
      };

      const result = salvageValidData(optionalNestedSchema, corruptedOptionalNested);

      expect(result.name).toBe("John");
      expect(result.optional?.required).toBe("valid");
      expect(result.optional?.other).toBe(0); // Default
    });

    it("falls back to undefined when optional nested object cannot be salvaged", () => {
      const optionalNestedSchema = z.object({
        name: z.string().default("default-name"),
        optional: z
          .object({
            required: z.string(), // Required field
          })
          .optional(),
      });

      const missingRequiredNested = {
        name: "John",
        optional: { other: "unexpected field" }, // Missing required field
      };

      const result = salvageValidData(optionalNestedSchema, missingRequiredNested);

      expect(result.name).toBe("John");
      expect(result.optional).toBeUndefined(); // Falls back to undefined
    });
  });
});

