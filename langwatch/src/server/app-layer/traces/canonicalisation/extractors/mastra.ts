/**
 * Mastra Extractor
 *
 * Handles: Mastra framework telemetry (mastra.* namespace)
 * Reference: https://mastra.ai/
 *
 * Mastra is an AI orchestration framework. This extractor handles mastra.span.type
 * to map Mastra's span types to canonical types.
 *
 * Detection (any of):
 * - Instrumentation scope name is "@mastra/otel"
 * - Instrumentation scope name is "@mastra/otel-bridge"
 * - Instrumentation scope name starts with "@mastra/"
 * - Span has "mastra.span.type" attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from mastra.span.type)
 * - gen_ai.request.model / gen_ai.response.model (from model_step input)
 * - gen_ai.input.messages (from model_step input)
 * - langwatch.span.display_name (contextual display names)
 *
 * Mastra span type mappings:
 * - agent_run → agent
 * - workflow_* → workflow
 * - workflow_step → component
 * - model_generation/model_step → llm
 * - model_chunk → span
 * - tool_call/mcp_tool_call → tool
 * - processor_run → component
 * - generic → span
 * - orphan/eval model_step → evaluation
 */

import { ATTR_KEYS } from "./_constants";
import { recordValueType } from "./_extraction";
import { asNumber } from "./_guards";
import {
  normalizeToMessages,
  extractSystemInstructionFromMessages,
} from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class MastraExtractor implements CanonicalAttributesExtractor {
  readonly id = "mastra";

  apply(ctx: ExtractorContext): void {
    const { span } = ctx;
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // Only process spans from Mastra instrumentation.
    // Uses multi-signal detection: scope name prefix OR mastra.span.type attr.
    // ─────────────────────────────────────────────────────────────────────────
    const scopeName = span.instrumentationScope?.name ?? "";
    const isMastra =
      scopeName === "@mastra/otel" ||
      scopeName === "@mastra/otel-bridge" ||
      scopeName.startsWith("@mastra/") ||
      attrs.has(ATTR_KEYS.MASTRA_SPAN_TYPE);

    if (!isMastra) {
      return;
    }

    const mastraType = attrs.get(ATTR_KEYS.MASTRA_SPAN_TYPE);

    // ─────────────────────────────────────────────────────────────────────────
    // Model Step Input Extraction (needed for eval detection + model name)
    // mastra.model_step.input contains {body: {model, messages, ...}}
    // ─────────────────────────────────────────────────────────────────────────
    const rawModelStepInput = attrs.get(ATTR_KEYS.MASTRA_MODEL_STEP_INPUT);
    const modelStepBody = extractBodyFromModelStepInput(rawModelStepInput);

    // Detect eval model_step: orphan (no parent) OR has response_format (structured output eval)
    const isEvalModelStep =
      mastraType === "model_step" &&
      (!span.parentSpanId || hasResponseFormat(modelStepBody));

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type Mapping
    // Map Mastra's detailed span types to canonical types.
    // Mastra takes precedence — always set type for Mastra-detected spans.
    // ─────────────────────────────────────────────────────────────────────────
    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, mastraSpanTypeToCanonical(mastraType, isEvalModelStep));
    ctx.recordRule(`${this.id}:mastra.span.type->langwatch.span.type`);

    let modelName: string | null = null;

    if (modelStepBody) {
      // Extract model name from body.model
      if (typeof modelStepBody.model === "string" && modelStepBody.model.length > 0) {
        modelName = modelStepBody.model;
        if (
          !attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) &&
          !attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL)
        ) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, modelName);
          ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, modelName);
          ctx.recordRule(`${this.id}:model_step.input.body.model->gen_ai.model`);
        }
      }

      // Extract input messages from body.messages
      if (
        Array.isArray(modelStepBody.messages) &&
        !attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) &&
        ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] === undefined
      ) {
        const msgs = normalizeToMessages(modelStepBody.messages, "user");
        if (msgs && msgs.length > 0) {
          const systemInstruction = extractSystemInstructionFromMessages(msgs);
          // Strip system messages — they go to gen_ai.request.system_instruction
          const chatMsgs = systemInstruction
            ? msgs.filter(
                (m) =>
                  !(
                    m &&
                    typeof m === "object" &&
                    (m as Record<string, unknown>).role === "system"
                  ),
              )
            : msgs;
          ctx.setAttr(
            ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
            chatMsgs.length > 0 ? chatMsgs : msgs,
          );
          recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
          if (systemInstruction !== null) {
            ctx.setAttrIfAbsent(
              ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
              systemInstruction,
            );
          }
          ctx.recordRule(
            `${this.id}:model_step.input.body.messages->gen_ai.input.messages`,
          );
        }
      }
    }

    // Fallback: try mastra.metadata.modelMetadata for model name
    if (!modelName) {
      modelName = extractModelFromMetadata(attrs);
      if (
        modelName &&
        !attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) &&
        !attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL) &&
        ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === undefined
      ) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, modelName);
        ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, modelName);
        ctx.recordRule(`${this.id}:metadata.modelMetadata->gen_ai.model`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // I/O Mapping
    // Map Mastra-specific I/O attributes to canonical langwatch.input/output
    // ─────────────────────────────────────────────────────────────────────────

    // For agent_run spans: extract I/O from mastra.agent_run.input/output
    if (mastraType === "agent_run") {
      if (!attrs.has(ATTR_KEYS.LANGWATCH_INPUT)) {
        const rawInput = attrs.get(ATTR_KEYS.MASTRA_AGENT_RUN_INPUT);
        if (rawInput !== undefined) {
          const lastUserMessage = extractLastUserMessage(rawInput);
          if (lastUserMessage) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, lastUserMessage);
            ctx.recordRule(
              `${this.id}:mastra.agent_run.input->langwatch.input`,
            );
          }
        }
      }

      if (!attrs.has(ATTR_KEYS.LANGWATCH_OUTPUT)) {
        const rawOutput = attrs.get(ATTR_KEYS.MASTRA_AGENT_RUN_OUTPUT);
        if (rawOutput !== undefined) {
          const text = extractAgentRunOutputText(rawOutput);
          if (text) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, text);
            ctx.recordRule(
              `${this.id}:mastra.agent_run.output->langwatch.output`,
            );
          }
        }
      }
    }

    // For model_step spans: extract text from mastra.model_step.output
    if (mastraType === "model_step" && !attrs.has(ATTR_KEYS.LANGWATCH_OUTPUT)) {
      const rawOutput = attrs.get(ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT);
      if (rawOutput !== undefined) {
        if (isEvalModelStep) {
          // For orphan eval spans: prefer structured object, fall back to text
          const evalOutput = extractEvalOutput(rawOutput);
          if (evalOutput) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, evalOutput);
            ctx.recordRule(
              `${this.id}:orphan.model_step.output->langwatch.output`,
            );
          }
        } else {
          const text = extractModelStepOutputText(rawOutput);
          if (text) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, text);
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
              { role: "assistant", content: text },
            ]);
            recordValueType(
              ctx,
              ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
              "chat_messages",
            );
            ctx.recordRule(
              `${this.id}:mastra.model_step.output->langwatch.output`,
            );
          }
        }
      }
    }

    // For orphan eval spans: extract system prompt as input
    if (isEvalModelStep && !attrs.has(ATTR_KEYS.LANGWATCH_INPUT)) {
      const systemPrompt = extractSystemPromptFromBody(modelStepBody);
      if (systemPrompt) {
        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, systemPrompt);
        ctx.recordRule(
          `${this.id}:orphan.system_prompt->langwatch.input`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Display Name Override
    // Set contextual display names based on span type and model.
    // Mutates span.name directly — extractors hold a mutable reference.
    // ─────────────────────────────────────────────────────────────────────────
    const displayName = deriveDisplayName({
      mastraType,
      modelName,
      isOrphan: isEvalModelStep,
      modelStepBody,
    });
    if (displayName) {
      span.name = displayName;
      ctx.recordRule(`${this.id}:display_name`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Thread ID extraction
    // Only extract threadId → gen_ai.conversation.id.
    // All other mastra.metadata.* keys are left untouched in the bag.
    // ─────────────────────────────────────────────────────────────────────────
    const threadId = attrs.take(ATTR_KEYS.MASTRA_METADATA_THREAD_ID);
    if (typeof threadId === "string" && threadId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, threadId);
      ctx.recordRule(`${this.id}:mastra.metadata.threadId->conversation.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Token Name Mapping
    // Mastra uses non-standard gen_ai.usage.cached_input_tokens — map to
    // canonical gen_ai.usage.cache_read.input_tokens
    // ─────────────────────────────────────────────────────────────────────────
    const cachedTokens = attrs.take(ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS);
    if (cachedTokens !== undefined) {
      const n = asNumber(cachedTokens);
      if (n !== null) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, n);
        ctx.recordRule(
          `${this.id}:cached_input_tokens->cache_read.input_tokens`,
        );
      }
    }
  }
}

/**
 * Maps a Mastra span type to a canonical langwatch.span.type.
 * Uses only valid SpanTypes values from the type system.
 */
function mastraSpanTypeToCanonical(mastraType: unknown, isOrphan: boolean): string {
  if (isOrphan) return "evaluation";

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
 * Extracts the last user message text from a Mastra agent_run input.
 * The input is an array of OpenAI-format messages: [{role, content}].
 */
function extractLastUserMessage(input: unknown): string | null {
  const messages = Array.isArray(input) ? input : null;
  if (!messages) return null;

  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "user") continue;

    const content = msg.content;
    if (typeof content === "string") return content;

    // Handle content array: [{type: "text", text: "..."}]
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
        } else if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string") {
            texts.push(p.text);
          }
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }

  return null;
}

/**
 * Extracts the text field from a Mastra model_step output.
 * The output is: {text: string, toolCalls: [...]}.
 */
function extractModelStepOutputText(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.length > 0) {
    return obj.text;
  }
  return null;
}

/**
 * Extracts the text field from a Mastra agent_run output.
 * The output is: {text: string, files: [...]}.
 */
function extractAgentRunOutputText(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.length > 0) {
    return obj.text;
  }
  return null;
}

/**
 * Checks whether a model_step body has response_format set.
 * Mastra evals use response_format: {type: "json_schema", ...} for structured output.
 */
function hasResponseFormat(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const rf = body.response_format;
  return rf !== undefined && rf !== null && typeof rf === "object";
}

/**
 * Extracts the body object from mastra.model_step.input.
 * Input format: {body: {model: string, messages: [...], ...}}
 */
function extractBodyFromModelStepInput(
  input: unknown,
): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const obj = input as Record<string, unknown>;
  const body = obj.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

/**
 * Extracts model name from mastra.metadata.modelMetadata attribute.
 * The attribute is an object: {modelId, modelVersion, modelProvider}
 */
function extractModelFromMetadata(
  attrs: { get: (key: string) => unknown },
): string | null {
  const metadata = attrs.get("mastra.metadata.modelMetadata");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const obj = metadata as Record<string, unknown>;
  if (typeof obj.modelId === "string" && obj.modelId.length > 0) {
    return obj.modelId;
  }
  return null;
}

/**
 * Extracts output from an orphan eval model_step.
 * Prefers structured object output, falls back to text.
 */
function extractEvalOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;

  // Prefer structured object (from structured output / JSON mode)
  if (obj.object !== undefined && obj.object !== null) {
    return typeof obj.object === "string" ? obj.object : JSON.stringify(obj.object);
  }
  // Fall back to text
  if (typeof obj.text === "string" && obj.text.length > 0) {
    return obj.text;
  }
  return null;
}

/**
 * Extracts system prompt content from the model_step body messages.
 */
function extractSystemPromptFromBody(
  body: Record<string, unknown> | null,
): string | null {
  if (!body || !Array.isArray(body.messages)) return null;

  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role === "system" && typeof m.content === "string" && m.content.length > 0) {
      return m.content;
    }
  }
  return null;
}

/**
 * Derives a contextual display name for a Mastra span.
 */
function deriveDisplayName({
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
      const desc = systemPrompt.length > 60
        ? systemPrompt.slice(0, 57) + "..."
        : systemPrompt;
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
