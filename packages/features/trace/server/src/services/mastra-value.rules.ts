import { z } from "zod";

const modelStepBodySchema = z.record(z.string(), z.unknown());
const modelStepInputSchema = z.looseObject({ body: modelStepBodySchema });
const outputSchema = z.looseObject({
  text: z.string().optional(),
  object: z.unknown().optional(),
});
const modelMetadataSchema = z.looseObject({ modelId: z.string() });
const contentPartSchema = z.looseObject({
  text: z.string().optional(),
  content: z.string().optional(),
});
const messageSchema = z.looseObject({
  role: z.string(),
  content: z.unknown().optional(),
});

/**
 * Maps a Mastra span type to a canonical langwatch.span.type.
 * Uses only valid SpanTypes values from the type system.
 */
export function mastraSpanTypeToCanonical(mastraType: unknown, isOrphan: boolean): string {
  if (isOrphan) {
    return "evaluation";
  }

  switch (mastraType) {
    case "agent_run":
      return "agent";

    case "workflow_run":
    case "workflow_conditional":
    case "workflow_conditional_eval":
    case "workflow_parallel":
    case "workflow_loop":
    case "workflow_sleep":
    case "workflow_wait_event":
      return "workflow";

    case "workflow_step":
      return "component";

    case "model_generation":
    case "model_step":
      return "llm";

    case "model_chunk":
      return "span";

    case "tool_call":
    case "mcp_tool_call":
      return "tool";

    case "processor_run":
      return "component";

    case "generic":
    default:
      return "span";
  }
}

/**
 * Extracts the `.text` field from a Mastra output object.
 * Works for both model_step output ({text, toolCalls}) and
 * agent_run output ({text, files}).
 */
export function extractTextFromOutput(output: unknown): string | null {
  const parsed = outputSchema.safeParse(output);
  return parsed.success && parsed.data.text ? parsed.data.text : null;
}

/**
 * Checks whether a model_step body has response_format set.
 * Mastra evals use response_format: {type: "json_schema", ...} for structured output.
 */
export function hasResponseFormat(body: Record<string, unknown> | null): boolean {
  if (!body) {
    return false;
  }
  const rf = body.response_format;
  return rf !== void 0 && rf !== null && typeof rf === "object";
}

/**
 * Extracts the body object from mastra.model_step.input.
 * Input format: {body: {model: string, messages: [...], ...}}
 */
export function extractBodyFromModelStepInput(input: unknown): Record<string, unknown> | null {
  const parsed = modelStepInputSchema.safeParse(input);
  return parsed.success ? parsed.data.body : null;
}

/**
 * Extracts model name from mastra.metadata.modelMetadata attribute.
 * The attribute is an object: {modelId, modelVersion, modelProvider}
 */
export function extractModelFromMetadata(attrs: { get: (key: string) => unknown }): string | null {
  const metadata = attrs.get("mastra.metadata.modelMetadata");
  const parsed = modelMetadataSchema.safeParse(metadata);
  return parsed.success && parsed.data.modelId.length > 0 ? parsed.data.modelId : null;
}

/**
 * Extracts output from an orphan eval model_step.
 * Prefers structured object output, falls back to text.
 */
export function extractEvalOutput(output: unknown): unknown {
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    return null;
  }

  // Prefer structured object (from structured output / JSON mode)
  if (parsed.data.object !== void 0 && parsed.data.object !== null) {
    return parsed.data.object;
  }
  // Fall back to text
  if (parsed.data.text) {
    return parsed.data.text;
  }
  return null;
}

/**
 * Normalizes message content to a string.
 * Handles string, array of content parts, and object with text/content fields.
 */
export function normalizeContentToString(content: unknown): string | null {
  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        const parsed = contentPartSchema.safeParse(part);
        if (!parsed.success) {
          return null;
        }
        if (parsed.data.text) {
          return parsed.data.text;
        }
        if (parsed.data.content) {
          return parsed.data.content;
        }
        return null;
      })
      .filter(Boolean);
    const joined = parts.join("\n");
    return joined.length > 0 ? joined : null;
  }

  const parsed = contentPartSchema.safeParse(content);
  if (parsed.success && parsed.data.text) {
    return parsed.data.text;
  }
  if (parsed.success && parsed.data.content) {
    return parsed.data.content;
  }

  return null;
}

/**
 * Extracts system prompt content from the model_step body messages.
 */
export function extractSystemPromptFromBody(body: Record<string, unknown> | null): string | null {
  if (!body || !Array.isArray(body.messages)) {
    return null;
  }

  for (const rawMessage of body.messages) {
    const message = messageSchema.safeParse(rawMessage);
    if (!message.success || message.data.role !== "system") {
      continue;
    }

    const text = normalizeContentToString(message.data.content);
    if (text) {
      return text;
    }
  }
  return null;
}

/**
 * Derives a contextual display name for a Mastra span.
 */
export function deriveDisplayName({
  mastraType,
  modelName,
  isOrphan,
  modelStepBody,
}: {
  mastraType: unknown;
  modelName: string | null;
  isOrphan: boolean;
  modelStepBody: Record<string, unknown> | null;
}): string | null {
  if (isOrphan) {
    // Try to extract a short description from the system prompt
    const systemPrompt = extractSystemPromptFromBody(modelStepBody);
    if (systemPrompt) {
      // Take first ~60 chars of the system prompt as description
      const desc = systemPrompt.length > 60 ? systemPrompt.slice(0, 57) + "..." : systemPrompt;
      return `Eval: ${desc}`;
    }
    return modelName ? `Eval: ${modelName}` : "Eval";
  }

  switch (mastraType) {
    case "model_generation":
      return modelName ? `LLM: ${modelName}` : null;
    case "model_step":
      return modelName ? `LLM Step: ${modelName}` : null;
    default:
      return null;
  }
}
