import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import {
  DEFAULT_MODEL,
  FALLBACK_MAX_TOKENS,
  MIN_MAX_TOKENS,
} from "~/utils/constants";
import { handleSchema, scopeSchema } from "./field-schemas";
import { versionMetadataSchema } from "./version-metadata-schema";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const llmSchema = z.object({
  model:
    latestConfigVersionSchema.shape.configData.shape.model.default(
      DEFAULT_MODEL,
    ),
  // Derive from DB schema to stay in sync
  temperature: latestConfigVersionSchema.shape.configData.shape.temperature,
  maxTokens: latestConfigVersionSchema.shape.configData.shape.max_tokens,
  // Traditional sampling parameters
  topP: latestConfigVersionSchema.shape.configData.shape.top_p,
  frequencyPenalty:
    latestConfigVersionSchema.shape.configData.shape.frequency_penalty,
  presencePenalty:
    latestConfigVersionSchema.shape.configData.shape.presence_penalty,
  // Other sampling parameters
  seed: latestConfigVersionSchema.shape.configData.shape.seed,
  topK: latestConfigVersionSchema.shape.configData.shape.top_k,
  minP: latestConfigVersionSchema.shape.configData.shape.min_p,
  repetitionPenalty:
    latestConfigVersionSchema.shape.configData.shape.repetition_penalty,
  // Reasoning model parameters
  reasoningEffort:
    latestConfigVersionSchema.shape.configData.shape.reasoning_effort,
  reasoning: latestConfigVersionSchema.shape.configData.shape.reasoning,
  verbosity: latestConfigVersionSchema.shape.configData.shape.verbosity,
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
      messages: latestConfigVersionSchema.shape.configData.shape.messages,
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs,
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: llmSchema,
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
        llm: z.object({
          model: llmSchema.shape.model,
          temperature: llmSchema.shape.temperature,
          maxTokens: llmSchema.shape.maxTokens
            .refine((val) => val === undefined || val <= maxTokenLimit, {
              message: `Max tokens cannot exceed ${maxTokenLimit.toLocaleString()}`,
            })
            .refine((val) => val === undefined || val >= MIN_MAX_TOKENS, {
              message: `Max tokens must be at least ${MIN_MAX_TOKENS}`,
            }),
          // Traditional sampling parameters
          topP: llmSchema.shape.topP,
          frequencyPenalty: llmSchema.shape.frequencyPenalty,
          presencePenalty: llmSchema.shape.presencePenalty,
          // Other sampling parameters
          seed: llmSchema.shape.seed,
          topK: llmSchema.shape.topK,
          minP: llmSchema.shape.minP,
          repetitionPenalty: llmSchema.shape.repetitionPenalty,
          // Reasoning model parameters
          reasoningEffort: llmSchema.shape.reasoningEffort,
          reasoning: llmSchema.shape.reasoning,
          verbosity: llmSchema.shape.verbosity,
          // Additional params attached to the LLM config
          litellmParams: llmSchema.shape.litellmParams,
        }),
      }),
    }),
  });
}

// Base schema for type inference and static parsing
export const formSchema = baseFormSchema;
