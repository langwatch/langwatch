import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import {
  FALLBACK_MAX_TOKENS,
  MIN_MAX_TOKENS,
} from "~/utils/constants";
import {
  handleSchema,
  runtimeParametersSchema,
  scopeSchema,
} from "./field-schemas";
import { versionMetadataSchema } from "./version-metadata-schema";

const latestConfigVersionSchema = getLatestConfigVersionSchema();

const llmSchema = z.object({
  model: latestConfigVersionSchema.shape.configData.shape.model,
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
  // Reasoning parameter (canonical/unified field)
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
    parameters: runtimeParametersSchema,
    configData: z.object({
      messages: latestConfigVersionSchema.shape.configData.shape.messages.removeDefault(),
      inputs: latestConfigVersionSchema.shape.configData.shape.inputs.removeDefault(),
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
 * Returns a refined form schema with dynamic model limits validation.
 *
 * Note: the system-prompt-required refinement (#3196) is applied separately
 * via {@link withSystemPromptRequired} so both this dynamic schema and the
 * static `formSchema` share the same client-side requirement.
 *
 * @param modelLimits - Optional model limits from server
 * @returns Zod schema with refined maxTokens validation based on model limits
 */
export function refinedFormSchemaWithModelLimits(
  modelLimits?: {
    maxOutputTokens?: number;
    maxTokens?: number;
  } | null,
) {
  const schema = baseFormSchemaWithModelLimits(modelLimits);
  return withSystemPromptRequired(schema);
}

function baseFormSchemaWithModelLimits(
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

/**
 * Refinement: require a non-empty system message in `messages`.
 *
 * Pre-#3196 the prompt form let users save a workflow whose system message
 * was empty (or simply absent), then surprised them with a 500 from the
 * server. The server now rejects with a friendly 400, but the form should
 * still block the submit client-side so the round-trip is never attempted.
 *
 * Trim before checking so whitespace-only content also fails — empty +
 * whitespace are functionally identical to the user.
 */
export const hasNonEmptySystemMessage = (
  messages:
    | readonly { role?: string; content?: string }[]
    | undefined
    | null,
): boolean =>
  !!messages?.some(
    (m) =>
      m?.role === "system" &&
      typeof m?.content === "string" &&
      m.content.trim() !== "",
  );

/**
 * Wraps a base form schema with a `superRefine` that requires a non-empty
 * system message in `messages`. Used by both the static {@link formSchema}
 * and the dynamic {@link refinedFormSchemaWithModelLimits} so both code
 * paths enforce the same client-side requirement.
 */
function withSystemPromptRequired<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((values, ctx) => {
    const messages = (
      values as { version?: { configData?: { messages?: unknown } } }
    ).version?.configData?.messages;
    if (
      !hasNonEmptySystemMessage(
        messages as
          | readonly { role: string; content: string }[]
          | undefined
          | null,
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

/**
 * The base form schema used for parsing prompts already persisted in the
 * DB and for typing form values. Does NOT include the system-prompt-required
 * refinement — DB records may pre-date the refinement and must still parse.
 *
 * Save-time validation uses {@link formSchemaForSave} (via
 * `refinedFormSchemaWithModelLimits` in the form resolver) so submits are
 * blocked when the system message is empty.
 */
export const formSchema = baseFormSchema;

/**
 * The form schema with the system-prompt-required refinement applied.
 * Used by `usePromptConfigForm`'s zodResolver so the Save button reflects
 * the requirement and shows the inline message-path error when violated.
 *
 * Read paths (`versionedPromptToPromptConfigFormValues`,
 * `useLoadSpanIntoPromptPlayground`) keep using {@link formSchema} so
 * legacy / pre-#3196 prompts still hydrate.
 */
export const formSchemaForSave = withSystemPromptRequired(baseFormSchema);
