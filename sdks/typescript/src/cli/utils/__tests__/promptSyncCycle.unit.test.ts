import { describe, it, expect } from "vitest";

import type { PromptResponse } from "@/client-sdk/services/prompts/types";

import { DEFAULT_PROMPT_MODEL } from "../../constants";
import { PromptConverter } from "../promptConverter";
import { responseFormatToOutputs } from "../responseFormat";

/**
 * End-to-end sync (no network): a prompt with a response_format is pushed
 * (→ outputs, server drops any model-rejected sampling param), then pulled
 * back (→ response_format). The user gets back what they had, on a working model.
 */
describe("prompt sync fidelity — full create→push→pull cycle", () => {
  /** @scenario A new structured-output prompt survives a full create, push and pull cycle */
  it("preserves the modern model and the response_format, with no rejected temperature", () => {
    // 1. Created from the CLI default template (no temperature by design),
    //    with a strict-JSON response_format added by the user.
    const responseFormat = {
      name: "product_category",
      schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["juice", "smoothie", "shot"] },
          reasoning: { type: "string" },
        },
        required: ["category", "reasoning"],
        additionalProperties: false,
      },
    };

    // 2. Push: response_format → platform outputs.
    const outputs = responseFormatToOutputs(responseFormat)!;

    // 3. Server stores it and, because the default model is a gpt-5-family
    //    model that rejects temperature, the prompts API never returns one
    //    (verified end-to-end in sampling-params-fidelity.integration.test.ts).
    const apiPrompt = {
      id: "p1",
      name: "product-classifier",
      version: 1,
      versionId: "v1",
      model: DEFAULT_PROMPT_MODEL,
      messages: [{ role: "system", content: "Classify the product." }],
      prompt: "Classify the product.",
      outputs,
      updatedAt: "2026-05-15T00:00:00.000Z",
    } as unknown as PromptResponse;

    // 4. Pull: API shape → materialized → local YAML.
    const materialized = PromptConverter.fromApiToMaterialized(apiPrompt);
    const yaml = PromptConverter.fromMaterializedToYaml(materialized);

    // Still on a current model, never a legacy gpt-4 / gpt-3.x generation.
    expect(yaml.model).toBe(DEFAULT_PROMPT_MODEL);
    expect(yaml.model).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);

    // No temperature the model would reject.
    expect(yaml.modelParameters?.temperature).toBeUndefined();

    // The response_format round-tripped exactly.
    expect(yaml.response_format).toEqual(responseFormat);
  });
});
