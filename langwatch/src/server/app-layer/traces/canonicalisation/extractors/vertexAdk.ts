/**
 * Vertex AI Agent Engine (Google ADK) Extractor
 *
 * Handles: Google Agent Development Kit / Vertex AI Agent Engine telemetry
 * Reference: https://google.github.io/adk-docs/observability/
 *
 * ADK emits standard gen_ai.* attributes (operation name, model, provider
 * "gcp.vertex.agent", token usage) but carries the actual conversation
 * content in vendor-specific JSON payloads:
 * - gcp.vertex.agent.llm_request: { model, config: { system_instruction,
 *   tools, ... }, contents: [{ role, parts: [{ text | function_call |
 *   function_response }] }] } (Gemini content format)
 * - gcp.vertex.agent.llm_response: { content: { role, parts }, partial,
 *   usage_metadata } (or raw Gemini { candidates: [{ content }] })
 * - gcp.vertex.agent.tool_call_args / tool_response on execute_tool spans
 *
 * Detection: gen_ai.provider.name / gen_ai.system = "gcp.vertex.agent",
 * or presence of any gcp.vertex.agent.* payload attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from gen_ai.operation.name: generate_content →
 *   llm, execute_tool → tool, invoke_agent → agent)
 * - gen_ai.input.messages / gen_ai.system_instructions (from llm_request)
 * - gen_ai.output.messages (from llm_response)
 * - gen_ai.request.model + gen_ai.request.* params (from llm_request)
 * - gen_ai.tool.definitions (from llm_request.config.tools)
 * - gen_ai.usage.* tokens (from llm_response.usage_metadata, only when
 *   the standard gen_ai.usage.* attributes are absent)
 * - langwatch.input/output + gen_ai.tool.call.arguments/result (from
 *   tool_call_args / tool_response on execute_tool spans)
 */

import { ATTR_KEYS } from "./_constants";
import { inferSpanTypeIfAbsent, recordValueType } from "./_extraction";
import { asNumber, isNonEmptyString, isRecord, safeJsonParse } from "./_guards";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
} from "./_types";

const VERTEX_ADK_PROVIDER = "gcp.vertex.agent";

const VERTEX_ADK_KEYS = {
  LLM_REQUEST: "gcp.vertex.agent.llm_request",
  LLM_RESPONSE: "gcp.vertex.agent.llm_response",
  TOOL_CALL_ARGS: "gcp.vertex.agent.tool_call_args",
  TOOL_RESPONSE: "gcp.vertex.agent.tool_response",
  SESSION_ID: "gcp.vertex.agent.session_id",
} as const;

const OPERATION_NAME_SPAN_TYPE_MAP: Record<string, string> = {
  generate_content: "llm",
  call_llm: "llm",
  chat: "llm",
  execute_tool: "tool",
  invoke_agent: "agent",
};

const safeStringify = (value: unknown): string | null => {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
};

/**
 * Gemini content roles are "user" | "model"; chat messages use
 * "user" | "assistant".
 */
const geminiRoleToChatRole = (role: unknown, defaultRole: string): string => {
  if (role === "model") return "assistant";
  return isNonEmptyString(role) ? role : defaultRole;
};

/**
 * Converts a single Gemini content object ({ role, parts }) into chat
 * messages. Text and function_call parts fold into one message (an
 * assistant turn can carry both text and tool calls); function_response
 * parts become separate tool-role messages, matching chat semantics —
 * ADK wraps tool results in a user-role content.
 */
const convertGeminiContent = (
  content: unknown,
  defaultRole: string,
): unknown[] => {
  if (!isRecord(content)) return [];

  const role = geminiRoleToChatRole(content.role, defaultRole);
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const messages: unknown[] = [];
  let texts: string[] = [];
  let toolCalls: unknown[] = [];

  const flush = () => {
    if (texts.length === 0 && toolCalls.length === 0) return;
    messages.push({
      role,
      ...(texts.length > 0 ? { content: texts.join("\n") } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
    texts = [];
    toolCalls = [];
  };

  for (const part of parts) {
    if (!isRecord(part)) continue;

    if (typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }

    if (isRecord(part.function_call)) {
      const fc = part.function_call;
      toolCalls.push({
        ...(isNonEmptyString(fc.id) ? { id: fc.id } : {}),
        type: "function",
        function: {
          name: isNonEmptyString(fc.name) ? fc.name : "",
          arguments: safeStringify(fc.args ?? {}) ?? "{}",
        },
      });
      continue;
    }

    if (isRecord(part.function_response)) {
      flush();
      const fr = part.function_response;
      messages.push({
        role: "tool",
        ...(isNonEmptyString(fr.id) ? { tool_call_id: fr.id } : {}),
        ...(isNonEmptyString(fr.name) ? { name: fr.name } : {}),
        content: safeStringify(fr.response ?? {}) ?? "{}",
      });
      continue;
    }
  }
  flush();

  return messages;
};

/**
 * ADK system instructions are usually a plain string, but the Gemini API
 * also accepts a content object ({ parts: [{ text }] }) or a list of
 * strings/parts.
 */
const systemInstructionText = (raw: unknown): string | null => {
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }

  const partsToText = (parts: unknown[]): string | null => {
    const texts: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        texts.push(part);
      } else if (isRecord(part) && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
    return texts.length > 0 ? texts.join("\n") : null;
  };

  if (Array.isArray(raw)) return partsToText(raw);
  if (isRecord(raw) && Array.isArray(raw.parts)) return partsToText(raw.parts);
  return null;
};

/**
 * Tool-call args/response arrive as a JSON string or an already-parsed
 * object. Normalise to a non-empty string for langwatch.input/output.
 */
const stringifyToolPayload = (raw: unknown): string | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  return safeStringify(raw);
};

export class VertexAdkExtractor implements CanonicalAttributesExtractor {
  readonly id = "vertex-adk";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // Provider name (bag or already lifted from legacy gen_ai.system by the
    // GenAI extractor) or presence of any gcp.vertex.agent.* payload key
    // ─────────────────────────────────────────────────────────────────────────
    const provider =
      attrs.get(ATTR_KEYS.GEN_AI_PROVIDER_NAME) ??
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) ??
      ctx.out[ATTR_KEYS.GEN_AI_PROVIDER_NAME];
    const isVertexAdk =
      provider === VERTEX_ADK_PROVIDER ||
      attrs.has(VERTEX_ADK_KEYS.LLM_REQUEST) ||
      attrs.has(VERTEX_ADK_KEYS.LLM_RESPONSE) ||
      attrs.has(VERTEX_ADK_KEYS.TOOL_CALL_ARGS) ||
      attrs.has(VERTEX_ADK_KEYS.TOOL_RESPONSE);

    if (!isVertexAdk) return;

    this.applySpanType(ctx);
    this.liftLlmRequest(ctx);
    this.liftLlmResponse(ctx);
    this.liftToolCall(ctx);
    this.liftSessionId(ctx);
  }

  /**
   * Sets a canonical attribute only when neither the raw attributes nor a
   * previous extractor already provide it. (ctx.setAttrIfAbsent checks the
   * bag too in production, but the explicit guard keeps the behaviour
   * self-contained and unit-testable.)
   */
  private setIfMissing(ctx: ExtractorContext, key: string, value: unknown) {
    if (ctx.bag.attrs.has(key) || ctx.out[key] !== undefined) return false;
    ctx.setAttr(key, value);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Span Type
  // ADK relies on gen_ai.operation.name; without this mapping the fallback
  // extractor sees generic gen_ai.* signals and types execute_tool spans
  // as "llm"
  // ─────────────────────────────────────────────────────────────────────────
  private applySpanType(ctx: ExtractorContext): void {
    const operationName = ctx.bag.attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    if (!isNonEmptyString(operationName)) return;

    const proposedSpanType = OPERATION_NAME_SPAN_TYPE_MAP[operationName];
    if (proposedSpanType) {
      inferSpanTypeIfAbsent(
        ctx,
        proposedSpanType,
        `${this.id}:gen_ai.operation.name->langwatch.span.type`,
      );
    }
  }

  private liftLlmRequest(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const request = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_REQUEST));
    if (!isRecord(request)) return;
    attrs.take(VERTEX_ADK_KEYS.LLM_REQUEST);

    // Model (standard gen_ai.request.model usually present; fallback only)
    if (
      isNonEmptyString(request.model) &&
      this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_REQUEST_MODEL, request.model)
    ) {
      ctx.recordRule(`${this.id}:llm_request.model->gen_ai.request.model`);
    }

    // Input messages (Gemini contents → chat messages)
    if (
      !attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) &&
      ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] === undefined &&
      Array.isArray(request.contents)
    ) {
      const messages = request.contents.flatMap((content) =>
        convertGeminiContent(content, "user"),
      );
      if (messages.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, messages);
        ctx.recordRule(`${this.id}:llm_request->gen_ai.input.messages`);
        recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
      }
    }

    const config = isRecord(request.config) ? request.config : undefined;
    if (config === undefined) return;

    // System instructions
    const sysInstruction = systemInstructionText(config.system_instruction);
    if (
      sysInstruction !== null &&
      this.setIfMissing(
        ctx,
        ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS,
        sysInstruction,
      )
    ) {
      ctx.recordRule(`${this.id}:system_instruction`);
    }

    // Tool definitions
    if (Array.isArray(config.tools) && config.tools.length > 0) {
      if (
        this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS, config.tools)
      ) {
        ctx.recordRule(`${this.id}:tools->gen_ai.tool.definitions`);
      }
    }

    // Request parameters
    const paramMap: [string, unknown][] = [
      [ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE, config.temperature],
      [ATTR_KEYS.GEN_AI_REQUEST_TOP_P, config.top_p],
      [ATTR_KEYS.GEN_AI_REQUEST_TOP_K, config.top_k],
      [ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS, config.max_output_tokens],
    ];
    let paramsExtracted = false;
    for (const [key, raw] of paramMap) {
      const value = asNumber(raw);
      if (value !== null && this.setIfMissing(ctx, key, value)) {
        paramsExtracted = true;
      }
    }
    if (paramsExtracted) {
      ctx.recordRule(`${this.id}:params`);
    }
  }

  private liftLlmResponse(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const response = safeJsonParse(attrs.get(VERTEX_ADK_KEYS.LLM_RESPONSE));
    if (!isRecord(response)) return;
    attrs.take(VERTEX_ADK_KEYS.LLM_RESPONSE);

    // Output messages: ADK LlmResponse carries a single content object;
    // raw Gemini responses carry candidates[].content
    if (
      !attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) &&
      ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === undefined
    ) {
      const messages: unknown[] = [];
      if (isRecord(response.content)) {
        messages.push(...convertGeminiContent(response.content, "assistant"));
      } else if (Array.isArray(response.candidates)) {
        for (const candidate of response.candidates) {
          if (isRecord(candidate) && isRecord(candidate.content)) {
            messages.push(
              ...convertGeminiContent(candidate.content, "assistant"),
            );
          }
        }
      }
      if (messages.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
        ctx.recordRule(`${this.id}:llm_response->gen_ai.output.messages`);
        recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
      }
    }

    // Usage tokens (fallback when the standard gen_ai.usage.* are absent)
    const usage = isRecord(response.usage_metadata)
      ? response.usage_metadata
      : undefined;
    if (usage !== undefined) {
      const usageMap: [string, unknown][] = [
        [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, usage.prompt_token_count],
        [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, usage.candidates_token_count],
        [
          ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
          usage.cached_content_token_count,
        ],
        [ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, usage.thoughts_token_count],
      ];
      let usageExtracted = false;
      for (const [key, raw] of usageMap) {
        const value = asNumber(raw);
        if (value !== null && this.setIfMissing(ctx, key, value)) {
          usageExtracted = true;
        }
      }
      if (usageExtracted) {
        ctx.recordRule(`${this.id}:usage_metadata->gen_ai.usage`);
      }
    }

    // Finish reason
    if (isNonEmptyString(response.finish_reason)) {
      if (
        this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS, [
          response.finish_reason,
        ])
      ) {
        ctx.recordRule(`${this.id}:finish_reason`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool Calls (execute_tool spans)
  // Mirrors the Vercel ai.toolCall.* lift: args/result become
  // langwatch.input/output plus the gen_ai.tool.call.* semconv keys so
  // the span detail reads like a real tool call
  // ─────────────────────────────────────────────────────────────────────────
  private liftToolCall(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const args = stringifyToolPayload(
      attrs.get(VERTEX_ADK_KEYS.TOOL_CALL_ARGS),
    );
    if (args !== null) {
      attrs.take(VERTEX_ADK_KEYS.TOOL_CALL_ARGS);
      this.setIfMissing(ctx, ATTR_KEYS.LANGWATCH_INPUT, args);
      this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS, args);
      ctx.recordRule(`${this.id}:tool_call_args->input`);
    }

    const result = stringifyToolPayload(
      attrs.get(VERTEX_ADK_KEYS.TOOL_RESPONSE),
    );
    if (result !== null) {
      attrs.take(VERTEX_ADK_KEYS.TOOL_RESPONSE);
      this.setIfMissing(ctx, ATTR_KEYS.LANGWATCH_OUTPUT, result);
      this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT, result);
      ctx.recordRule(`${this.id}:tool_response->output`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation ID
  // ADK usually emits gen_ai.conversation.id alongside; fall back to the
  // vendor session id when it doesn't. The vendor key stays as a
  // passthrough attribute — it's an identifier users may filter on.
  // ─────────────────────────────────────────────────────────────────────────
  private liftSessionId(ctx: ExtractorContext): void {
    const sessionId = ctx.bag.attrs.get(VERTEX_ADK_KEYS.SESSION_ID);
    if (
      isNonEmptyString(sessionId) &&
      this.setIfMissing(ctx, ATTR_KEYS.GEN_AI_CONVERSATION_ID, sessionId)
    ) {
      ctx.recordRule(`${this.id}:session_id->gen_ai.conversation.id`);
    }
  }
}
