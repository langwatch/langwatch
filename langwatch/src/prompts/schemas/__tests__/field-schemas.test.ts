import { describe, it, expect } from "vitest";
import { responseFormatSchema, outputsSchema } from "../field-schemas";

describe("responseFormatSchema", () => {
  describe("when json_schema contains a full schema with properties", () => {
    it("preserves all schema properties through validation", () => {
      const input = {
        type: "json_schema" as const,
        json_schema: {
          name: "requirement_to_column_mapping",
          schema: {
            type: "object",
            properties: {
              requirement_to_column_mapping: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    requirement_property_name: { type: "string" },
                    column_id: { type: "string" },
                    column_name: { type: "string" },
                    cell_value_field_name: {
                      type: "string",
                      enum: ["Boolean", "String", "Datetime", "Decimal"],
                    },
                  },
                  required: [
                    "requirement_property_name",
                    "column_id",
                    "column_name",
                    "cell_value_field_name",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["requirement_to_column_mapping"],
            additionalProperties: false,
          },
        },
      };

      const result = responseFormatSchema.parse(input);

      // The full schema must be preserved, not stripped to {}
      expect(result.json_schema!.schema).toEqual(input.json_schema.schema);
      expect(result.json_schema!.schema).toHaveProperty("properties");
      expect(result.json_schema!.schema).toHaveProperty("required");
      expect(result.json_schema!.schema).toHaveProperty("additionalProperties");
    });
  });

  describe("when json_schema has a simple schema", () => {
    it("preserves the type and properties fields", () => {
      const input = {
        type: "json_schema" as const,
        json_schema: {
          name: "simple_output",
          schema: {
            type: "object",
            properties: {
              value: { type: "string" },
            },
          },
        },
      };

      const result = responseFormatSchema.parse(input);

      expect(result.json_schema!.schema).toEqual({
        type: "object",
        properties: {
          value: { type: "string" },
        },
      });
    });
  });

  describe("when json_schema is null", () => {
    it("accepts null json_schema", () => {
      const input = {
        type: "json_schema" as const,
        json_schema: null,
      };

      const result = responseFormatSchema.parse(input);
      expect(result.json_schema).toBeNull();
    });
  });

  describe("when schema is an empty object", () => {
    it("accepts empty schema", () => {
      const input = {
        type: "json_schema" as const,
        json_schema: {
          name: "empty",
          schema: {},
        },
      };

      const result = responseFormatSchema.parse(input);
      expect(result.json_schema!.schema).toEqual({});
    });
  });
});

describe("outputsSchema", () => {
  describe("when output type is json_schema with json_schema field", () => {
    it("preserves the full json_schema definition", () => {
      const input = {
        identifier: "requirement_to_column_mapping",
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            mapping: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["mapping"],
          additionalProperties: false,
        },
      };

      const result = outputsSchema.parse(input);

      expect(result.json_schema).toEqual(input.json_schema);
      expect(result.json_schema).toHaveProperty("properties");
      expect(result.json_schema).toHaveProperty("required");
      expect(result.json_schema).toHaveProperty("additionalProperties");
    });
  });

  describe("when output type is str", () => {
    it("accepts without json_schema", () => {
      const input = {
        identifier: "output",
        type: "str",
      };

      const result = outputsSchema.parse(input);
      expect(result.identifier).toBe("output");
      expect(result.type).toBe("str");
      expect(result.json_schema).toBeUndefined();
    });
  });
});
