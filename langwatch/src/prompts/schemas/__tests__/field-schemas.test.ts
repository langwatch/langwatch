import { describe, it, expect } from "vitest";
import {
  responseFormatSchema,
  outputsSchema,
  deriveResponseFormatFromOutputs,
} from "../field-schemas";

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

describe("deriveResponseFormatFromOutputs", () => {
  it("derives response_format from output with json_schema type", () => {
    const outputs = [
      {
        identifier: "mapping_result",
        type: "json_schema" as const,
        json_schema: {
          type: "object",
          properties: {
            items: { type: "array", items: { type: "string" } },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    ];

    const result = deriveResponseFormatFromOutputs(outputs);

    expect(result).toEqual({
      type: "json_schema",
      json_schema: {
        name: "mapping_result",
        schema: outputs[0]!.json_schema,
      },
    });
  });

  it("returns undefined when no output has json_schema type", () => {
    const outputs = [
      { identifier: "output", type: "str" as const },
    ];

    const result = deriveResponseFormatFromOutputs(outputs);
    expect(result).toBeUndefined();
  });

  it("returns undefined when json_schema output has no json_schema field", () => {
    const outputs = [
      { identifier: "output", type: "json_schema" as const },
    ];

    const result = deriveResponseFormatFromOutputs(outputs);
    expect(result).toBeUndefined();
  });

  it("uses the first json_schema output when multiple exist", () => {
    const outputs = [
      {
        identifier: "first_output",
        type: "json_schema" as const,
        json_schema: { type: "object", properties: { a: { type: "string" } } },
      },
      {
        identifier: "second_output",
        type: "json_schema" as const,
        json_schema: { type: "object", properties: { b: { type: "number" } } },
      },
    ];

    const result = deriveResponseFormatFromOutputs(outputs);
    expect(result!.json_schema!.name).toBe("first_output");
  });

  it("returns undefined for empty outputs array", () => {
    const result = deriveResponseFormatFromOutputs([]);
    expect(result).toBeUndefined();
  });
});
