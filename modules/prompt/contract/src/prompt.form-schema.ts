import { z } from "zod";

import { handleSchema, runtimeParametersSchema, scopeSchema } from "./prompt.field-schemas.ts";
import { getLatestConfigVersionSchema } from "./prompt.version-schema.ts";
import { FALLBACK_MAX_TOKENS, MIN_MAX_TOKENS } from "./prompt.token-limits.ts";
import { versionMetadataSchema } from "./prompt.version-metadata.ts";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const llmSchema = z.object({
  model: latestConfigVersionSchema.shape.configData.shape.model,
  // Derive from DB schema to stay in sync
  temperature: latestConfigVersionSchema.shape.configData.shape.temperature,
  maxTokens: latestConfigVersionSchema.shape.configData.shape.max_tokens,
  // Traditional sampling parameters
  topP: latestConfigVersionSchema.shape.configData.shape.top_p,
  frequencyPenalty: latestConfigVersionSchema.shape.configData.shape.frequency_penalty,
  presencePenalty: latestConfigVersionSchema.shape.configData.shape.presence_penalty,
  // Other sampling parameters
  seed: latestConfigVersionSchema.shape.configData.shape.seed,
  topK: latestConfigVersionSchema.shape.configData.shape.top_k,
  minP: latestConfigVersionSchema.shape.configData.shape.min_p,
  repetitionPenalty: latestConfigVersionSchema.shape.configData.shape.repetition_penalty,
  // Reasoning parameter (canonical/unified field)
  reasoning: latestConfigVersionSchema.shape.configData.shape.reasoning,
  verbosity: latestConfigVersionSchema.shape.configData.shape.verbosity,
  litellmParams: z.record(z.string(), z.string()).optional(),
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
    // The form always provides this field. Keep the reusable API schema's
    // default at its transport boundaries without widening the form input.
    parameters: runtimeParametersSchema.removeDefault(),
    configData: z.object({
      messages: latestConfigVersionSchema.shape.configData.shape.messages.removeDefault(),
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs.removeDefault(),
      outputs: latestConfigVersionSchema.shape.configData.shape.outputs,
      llm: llmSchema,
      demonstrations: latestConfigVersionSchema.shape.configData.shape.demonstrations,
      promptingTechnique: latestConfigVersionSchema.shape.configData.shape.prompting_technique,
      responseFormat: latestConfigVersionSchema.shape.configData.shape.response_format,
    }),
  }),
});

/** Refined form schema with dynamic model limits validation; system-prompt requirement applied. */
export function refinedFormSchemaWithModelLimits(
  modelLimits?: {
    maxOutputTokens?: number;
    maxTokens?: number;
  } | null,
): typeof baseFormSchema {
  const schema = baseFormSchemaWithModelLimits(modelLimits);
  return withSystemPromptRequired(schema);
}

function baseFormSchemaWithModelLimits(
  modelLimits?: {
    maxOutputTokens?: number;
    maxTokens?: number;
  } | null,
): typeof baseFormSchema {
  if (!modelLimits) {
    return baseFormSchema;
  }

  const maxTokenLimit =
    modelLimits?.maxOutputTokens ?? modelLimits?.maxTokens ?? FALLBACK_MAX_TOKENS;

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
          // Reasoning parameter (canonical/unified field)
          reasoning: llmSchema.shape.reasoning,
          verbosity: llmSchema.shape.verbosity,
          // Additional params attached to the LLM config
          litellmParams: llmSchema.shape.litellmParams,
        }),
      }),
    }),
  });
}

/** Require non-empty system message; trim before checking so whitespace-only content also fails. */
export const hasNonEmptySystemMessage = (
  messages: readonly { role?: string; content?: string }[] | undefined | null,
): boolean =>
  !!messages?.some(
    (m) => m?.role === "system" && typeof m?.content === "string" && m.content.trim() !== "",
  );

/**
 * Wraps a base form schema with a `superRefine` that requires a non-empty
 * system message in `messages`. Used by both the static {@link formSchema}
 * and the dynamic {@link refinedFormSchemaWithModelLimits} so both code
 * paths enforce the same client-side requirement.
 */
function withSystemPromptRequired<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((values, ctx) => {
    const messages = (values as { version?: { configData?: { messages?: unknown } } }).version
      ?.configData?.messages;
    if (
      !hasNonEmptySystemMessage(
        messages as readonly { role: string; content: string }[] | undefined | null,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["version", "configData", "messages"],
        message: "System prompt is required.",
      });
    }
  });
}

/** Base form schema; no system-prompt-required refinement for legacy prompt compatibility. */
export const formSchema = baseFormSchema;

/** Form schema for saving; system-prompt-required refinement applied (zodResolver). */
export const formSchemaForSave = withSystemPromptRequired(baseFormSchema);

/** Form values for prompt configuration management, inferred from formSchema. */
export type PromptConfigFormValues = z.infer<typeof formSchema>;
