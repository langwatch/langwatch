import { describe, it, expect } from "vitest";
import {
  outputsToResponseFormat,
  responseFormatToOutputs,
  type CliOutput,
} from "../responseFormat";
import { PromptConverter } from "../promptConverter";
import type { MaterializedPrompt } from "../../types";

const materialized = (
  overrides: Partial<MaterializedPrompt>,
): MaterializedPrompt => ({
  id: "p1",
  name: "category-classifier",
  version: 3,
  versionId: "v3",
  model: "openai/gpt-5.4-mini",
  messages: [{ role: "system", content: "classify" }],
  prompt: "classify",
  config: {},
  updatedAt: "2026-05-15T00:00:00.000Z",
  ...overrides,
});

describe("prompt sync fidelity — response_format round-trip", () => {
  describe("given a remote prompt with a json_schema output (pull direction)", () => {
    const picnicSchema = {
      type: "object",
      properties: {
        l3: { type: "string", enum: ["Vers", "Smoothies"] },
        reasoning: { type: "string" },
      },
      required: ["l3", "reasoning"],
      additionalProperties: false,
    };
    const outputs: CliOutput[] = [
      {
        identifier: "picnic_category",
        type: "json_schema",
        json_schema: picnicSchema,
      },
    ];

    /** @scenario Pulling a prompt with a JSON-schema output reconstructs response_format */
    it("reconstructs the response_format block on materialize", () => {
      const yaml = PromptConverter.fromMaterializedToYaml(
        materialized({ outputs }),
      );

      expect(yaml.response_format).toEqual({
        name: "picnic_category",
        schema: picnicSchema,
      });
    });
  });

  describe("given a remote prompt with flat structured-output fields (pull direction)", () => {
    const outputs: CliOutput[] = [
      { identifier: "l1", type: "str" },
      { identifier: "l2", type: "str" },
      { identifier: "l3", type: "str" },
      { identifier: "reasoning", type: "str" },
    ];

    /** @scenario Pulling a prompt with flat structured-output fields synthesizes a single-level JSON schema */
    it("synthesizes a single-level object JSON schema", () => {
      const yaml = PromptConverter.fromMaterializedToYaml(
        materialized({ outputs }),
      );

      expect(yaml.response_format?.schema).toEqual({
        type: "object",
        properties: {
          l1: { type: "string" },
          l2: { type: "string" },
          l3: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["l1", "l2", "l3", "reasoning"],
        additionalProperties: false,
      });
    });
  });

  describe("given a plain-text remote prompt (pull direction)", () => {
    /** @scenario Pulling a plain text prompt does not invent a response_format */
    it("emits no response_format block", () => {
      const yaml = PromptConverter.fromMaterializedToYaml(
        materialized({ outputs: [{ identifier: "output", type: "str" }] }),
      );

      expect(yaml.response_format).toBeUndefined();
    });
  });

  describe("given a pushed response_format coming back from the API", () => {
    /** @scenario A response_format pushed up comes back identical on pull */
    it("yields the same response_format after a push→pull cycle", () => {
      const localResponseFormat = {
        name: "picnic_category",
        schema: {
          type: "object",
          properties: {
            l3: { type: "string", enum: ["Vers", "Smoothies"] },
          },
          required: ["l3"],
          additionalProperties: false,
        },
      };

      // push: response_format → outputs (what the CLI sends to the API)
      const pushedOutputs = responseFormatToOutputs(localResponseFormat);

      // pull: API outputs → response_format (what lands back in YAML)
      const pulled = outputsToResponseFormat(pushedOutputs);

      expect(pulled).toEqual(localResponseFormat);
    });
  });

  describe("given a flat object-schema response_format being pushed", () => {
    /** @scenario An object-schema response_format round-trips back to flat platform fields */
    it("expands to flat platform fields, not one json_schema catch-all", () => {
      const outputs = responseFormatToOutputs({
        name: "output",
        schema: {
          type: "object",
          properties: {
            l1: { type: "string" },
            l2: { type: "string" },
            l3: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["l1", "l2", "l3", "reasoning"],
          additionalProperties: false,
        },
      });

      expect(outputs).toEqual([
        { identifier: "l1", type: "str" },
        { identifier: "l2", type: "str" },
        { identifier: "l3", type: "str" },
        { identifier: "reasoning", type: "str" },
      ]);
      expect(outputs?.some((o) => o.type === "json_schema")).toBe(false);
    });
  });

  describe("when the OpenAI-standard response_format wrapper is used", () => {
    it("normalizes the wrapped form on push", () => {
      const outputs = responseFormatToOutputs({
        type: "json_schema",
        json_schema: {
          name: "picnic_category",
          schema: {
            type: "object",
            properties: { l3: { type: "string", enum: ["Vers"] } },
            required: ["l3"],
            additionalProperties: false,
          },
        },
      });

      expect(outputs).toEqual([
        {
          identifier: "picnic_category",
          type: "json_schema",
          json_schema: {
            type: "object",
            properties: { l3: { type: "string", enum: ["Vers"] } },
            required: ["l3"],
            additionalProperties: false,
          },
        },
      ]);
    });
  });
});
