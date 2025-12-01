import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { handleSchema, scopeSchema } from "./field-schemas";
import { versionMetadataSchema } from "./version-metadata-schema";
import {
  DEFAULT_MODEL,
  MIN_MAX_TOKENS,
  FALLBACK_MAX_TOKENS,
} from "~/utils/constants";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const llmSchemaWithPreprocessing = z.object({
  model:
    latestConfigVersionSchema.shape.configData.shape.model.default(
      DEFAULT_MODEL,
    ),
  temperature: z.number(),
  maxTokens: z.number(),
  litellmParams: z.record(z.string()).optional(),
});

// Base schema with static validation using fallback limits
const baseFormSchema = z.object({
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
      llm: llmSchemaWithPreprocessing,
      demonstrations:
        latestConfigVersionSchema.shape.configData.shape.demonstrations,
      promptingTechnique:
        latestConfigVersionSchema.shape.configData.shape.prompting_technique,
      responseFormat:
        latestConfigVersionSchema.shape.configData.shape.response_format,
    }),
  }),
});

/**
 * Returns a refined form schema with dynamic model limits validation
 * @param modelLimits - Optional model limits from server
 * @returns Zod schema with refined maxTokens validation based on model limits
 */
export function refinedFormSchemaWithModelLimits(
  modelLimits?: {
    maxOutputTokens?: number;
    maxTokens?: number;
  } | null,
) {
  if (!modelLimits) {
    return baseFormSchema;
  }

  const maxTokenLimit =
    modelLimits?.maxOutputTokens ??
    modelLimits?.maxTokens ??
    FALLBACK_MAX_TOKENS;

  // Only refine if the limit is different from fallback
  if (maxTokenLimit === FALLBACK_MAX_TOKENS) {
    return baseFormSchema;
  }

  // Return the base schema with refined maxTokens validation
  return baseFormSchema.extend({
    version: baseFormSchema.shape.version.extend({
      configData: baseFormSchema.shape.version.shape.configData.extend({
        llm: z
          .object({
            model: llmSchemaWithPreprocessing.shape.model,
            temperature: llmSchemaWithPreprocessing.shape.temperature,
            maxTokens: llmSchemaWithPreprocessing.shape.maxTokens
              .refine((val) => val <= maxTokenLimit, {
                message: `Max tokens cannot exceed ${maxTokenLimit.toLocaleString()}`,
              })
              .refine((val) => val >= MIN_MAX_TOKENS, {
                message: `Max tokens must be at least ${MIN_MAX_TOKENS}`,
              }),
            // Additional params attached to the LLM config
            litellmParams: llmSchemaWithPreprocessing.shape.litellmParams,
          })
          .refine(
            (data) => {
              const isGpt5 = data.model.includes("gpt-5");
              if (!isGpt5) return true;
              return isGpt5 && data.temperature !== 1 ? false : true;
            },
            {
              message: "Temperature must be 1 for GPT-5 models",
              path: ["temperature"],
            },
          ),
      }),
    }),
  });
}

// Base schema for type inference and static parsing
export const formSchema = baseFormSchema;
