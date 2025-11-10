import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { handleSchema, scopeSchema } from "./field-schemas";
import { versionMetadataSchema } from "./version-metadata-schema";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "~/utils/constants";

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
          temperature: z.preprocess((v) => v ?? 0.7, z.number()),
          maxTokens: z.preprocess((v) => v ?? 1000, z.number()),
          // Additional params attached to the LLM config
          litellmParams: z.record(z.string()).optional(),
        })
        .transform((data) => ({
          ...data,
          // Auto-fix: Force temperature to 1 for GPT-5 models
          temperature: data.model.includes("gpt-5") ? 1 : data.temperature,
          // Auto-fix: Ensure maxTokens is at least DEFAULT_MAX_TOKENS for GPT-5
          maxTokens: data.model.includes("gpt-5")
            ? Math.max(data.maxTokens, DEFAULT_MAX_TOKENS)
            : data.maxTokens,
        })),
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
      promptingTechnique:
        latestConfigVersionSchema.shape.configData.shape.prompting_technique,
      responseFormat:
        latestConfigVersionSchema.shape.configData.shape.response_format,
    }),
  }),
});
