import { describe, expect, it } from "vitest";
import { LlmConfigRepository } from "../repositories/llm-config.repository";
import { transformCamelToSnake } from "../transformToDbFormat";

/**
 * Regression tests for the false diff bug in prompt sync.
 *
 * Root cause: older CLIs send response_format alongside outputs in the
 * configData payload. The server's syncPrompt builds remoteConfigData
 * WITHOUT response_format (since it's derived from outputs). When
 * compareConfigContent normalizes both through Zod, one has response_format
 * and the other doesn't, causing a false diff on every sync.
 *
 * Fix: compareConfigContent strips response_format before comparing,
 * because it's always derivable from outputs and not a real difference.
 */
describe("compareConfigContent()", () => {
  const repository = new LlmConfigRepository(null as any);

  const jsonSchemaOutputs = [
    {
      identifier: "requirement_to_column_mapping",
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: {
          requirement_to_column_mapping: {
            type: "array",
            items: {
              type: "object",
              properties: {
                requirement_property_name: {
                  type: "string",
                  description:
                    "The requirement property to use for this mapping",
                },
                column_id: {
                  type: "string",
                  description:
                    "The ID of the column the requirement is mapped to",
                },
                column_name: {
                  type: "string",
                  description:
                    "The name of the column the requirement is mapped to",
                },
                cell_value_field_name: {
                  type: "string",
                  enum: ["Boolean", "String", "Datetime", "Decimal"],
                  description:
                    "The field type of the cell value used for mapping",
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
  ];

  const baseConfig = {
    model: "openai/gpt-4o",
    prompt:
      "Your job is to take make a mapping dictionary...\n{{ dto_schema }}\n{{ example_candidates }}\n{% for col in column_headers %}...{% endfor %}\n",
    messages: [{ role: "user" as const, content: "{{ input }}" }],
    temperature: 0,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: jsonSchemaOutputs,
  };

  describe("given an older CLI sending response_format alongside outputs", () => {
    describe("when server remoteConfigData omits response_format (derived from outputs)", () => {
      it("ignores response_format and detects configs as equal", () => {
        // Older CLI sends both outputs AND response_format
        const localConfigData = {
          ...baseConfig,
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: "requirement_to_column_mapping",
              schema: jsonSchemaOutputs[0]!.json_schema,
            },
          },
        };

        // Server's syncPrompt builds remoteConfigData WITHOUT response_format
        const remoteConfigData = { ...baseConfig };

        const result = repository.compareConfigContent(
          localConfigData,
          remoteConfigData,
        );

        expect(result.isEqual).toBe(true);
      });
    });
  });

  describe("given a new CLI that does not send response_format", () => {
    describe("when comparing with server remoteConfigData", () => {
      it("detects configs as equal", () => {
        const localConfigData = { ...baseConfig };
        const remoteConfigData = { ...baseConfig };

        const result = repository.compareConfigContent(
          localConfigData,
          remoteConfigData,
        );

        expect(result.isEqual).toBe(true);
      });
    });
  });

  describe("given a full round-trip through transformToDbFormat and JSON storage", () => {
    describe("when second sync sends the same CLI data", () => {
      it("detects configs as equal after DB round-trip", () => {
        const cliConfigData = { ...baseConfig };

        // Simulate transformToDbFormat on creation
        const storedConfigData = transformCamelToSnake({ ...cliConfigData });

        // Simulate JSON round-trip (Prisma storage)
        const dbRoundTripped = JSON.parse(JSON.stringify(storedConfigData));

        // Build remoteConfigData as syncPrompt would
        const remoteConfigData = {
          model: dbRoundTripped.model,
          prompt: dbRoundTripped.prompt,
          messages: dbRoundTripped.messages,
          inputs: dbRoundTripped.inputs,
          outputs: dbRoundTripped.outputs,
          ...(dbRoundTripped.temperature !== undefined && {
            temperature: dbRoundTripped.temperature,
          }),
          ...(dbRoundTripped.max_tokens !== undefined && {
            max_tokens: dbRoundTripped.max_tokens,
          }),
        };

        // Second sync sends the same data
        const result = repository.compareConfigContent(
          cliConfigData,
          remoteConfigData,
        );

        expect(result.isEqual).toBe(true);
      });
    });
  });

  describe("given both configs have the same response_format", () => {
    describe("when comparing", () => {
      it("detects them as equal (response_format stripped from both)", () => {
        const responseFormat = {
          type: "json_schema" as const,
          json_schema: {
            name: "requirement_to_column_mapping",
            schema: jsonSchemaOutputs[0]!.json_schema,
          },
        };

        const config1 = { ...baseConfig, response_format: responseFormat };
        const config2 = { ...baseConfig, response_format: responseFormat };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(true);
      });
    });
  });

  describe("given real content differences exist alongside response_format", () => {
    describe("when prompt text differs", () => {
      it("still detects the real difference", () => {
        const localConfigData = {
          ...baseConfig,
          prompt: "Different prompt content",
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: "requirement_to_column_mapping",
              schema: jsonSchemaOutputs[0]!.json_schema,
            },
          },
        };

        const remoteConfigData = { ...baseConfig };

        const result = repository.compareConfigContent(
          localConfigData,
          remoteConfigData,
        );

        expect(result.isEqual).toBe(false);
        expect(result.differences).toContain("prompt content differs");
      });
    });
  });
});
