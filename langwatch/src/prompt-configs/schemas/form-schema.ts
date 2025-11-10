import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { handleSchema, scopeSchema } from "./field-schemas";
import { versionMetadataSchema } from "./version-metadata-schema";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  MIN_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
} from "~/utils/constants";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

export const formSchema = z.object({
  // Config ID (separate from version metadata)
  configId: z.string().optional(),

  // Version metadata (only present when loaded from database)
  versionMetadata: versionMetadataSchema.optional(),

  // Visible fields
  handle: handleSchema.nullable(),
  scope: scopeSchema,
  version: z.object({
    configData: z.object({
      prompt: latestConfigVersionSchema.shape.configData.shape.prompt,
      messages: latestConfigVersionSchema.shape.configData.shape.messages,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: z
        .object({
          model:
            latestConfigVersionSchema.shape.configData.shape.model.default(
              DEFAULT_MODEL,
            ),
          temperature: z.preprocess(
            (v) => v ?? DEFAULT_TEMPERATURE,
            z.number(),
          ),
          maxTokens: z.preprocess((v) => v ?? DEFAULT_MAX_TOKENS, z.number()),
          // Additional params attached to the LLM config
          litellmParams: z.record(z.string()).optional(),
        })
        .transform((data) => {
          // Data integrity layer: Enforce minimum constraints
          // GPT-5: temperature=1, min 128k tokens
          // Other models: min 256 tokens
          // Note: UI (LLMConfigModal) provides smart UX on top of this
          const isGpt5 = data.model.includes("gpt-5");
          const temperature = isGpt5 ? 1 : data.temperature;
          const maxTokens = isGpt5
            ? Math.max(data.maxTokens, DEFAULT_MAX_TOKENS)
            : Math.max(data.maxTokens, MIN_MAX_TOKENS);

          return {
            ...data,
            temperature,
            maxTokens,
          };
        }),
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
      promptingTechnique:
        latestConfigVersionSchema.shape.configData.shape.prompting_technique,
      responseFormat:
        latestConfigVersionSchema.shape.configData.shape.response_format,
    }),
  }),
});
