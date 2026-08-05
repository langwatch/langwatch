import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COMMAND_TYPES } from "../../domain/commandType";
import { defineCommandSchema } from "../commandSchema";

describe("defineCommandSchema", () => {
  describe("when creating a schema with all parameters", () => {
    it("preserves the command type", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      expect(schema.type).toBe(COMMAND_TYPES[0]);
    });

    it("preserves the description when provided", () => {
      const zodSchema = z.string();
      const description = "Test command schema description";
      const schema = defineCommandSchema(
        COMMAND_TYPES[0],
        zodSchema,
        description,
      );

      expect(schema.description).toBe(description);
    });

    it("preserves the validate function", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      expect(typeof schema.validate).toBe("function");
    });
  });

  describe("when creating a schema without description", () => {
    it("returns a schema with undefined description", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      expect(schema.description).toBeUndefined();
    });
  });

  describe("when using the validate function", () => {
    it("validates the payload correctly", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      const testPayload = "test-payload";
      const result = schema.validate(testPayload);

      expect(result.success).toBe(true);
    });

    it("returns true when validator returns true", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      const result = schema.validate("valid-string");

      expect(result.success).toBe(true);
    });

    it("returns false when validator returns false", () => {
      const zodSchema = z.string();
      const schema = defineCommandSchema(COMMAND_TYPES[0], zodSchema);

      const result = schema.validate(123);

      expect(result.success).toBe(false);
    });

    it("works with complex payload types", () => {
      const complexPayloadSchema = z.object({
        id: z.string(),
        data: z.array(z.number()),
      });

      const schema = defineCommandSchema(
        COMMAND_TYPES[0],
        complexPayloadSchema,
      );

      const validPayload = { id: "test-id", data: [1, 2, 3] };
      const invalidPayload = { id: "test-id" };

      expect(schema.validate(validPayload).success).toBe(true);
      expect(schema.validate(invalidPayload).success).toBe(false);
    });
  });

  describe("when working with different command types", () => {
    it.todo("preserves different command types correctly");
  });
});
