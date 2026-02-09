/**
 * LangWatch Native SDK Extractor
 *
 * Handles: LangWatch SDK attributes (langwatch.* namespace)
 *
 * This extractor handles attributes sent directly from LangWatch SDKs,
 * including legacy attribute names that need normalization. It also handles
 * the structured input/output format used by frameworks like DSPy:
 * - langwatch.input: { type: "chat_messages", value: [...messages] }
 * - langwatch.output: { type: "json" | "chat_messages", value: [...] }
 *
 * Detection: Presence of langwatch.* attributes
 *
 * Canonical attributes produced:
 * - langwatch.span.type (passthrough, upgraded to "llm" for chat_messages)
 * - gen_ai.conversation.id (from langwatch.thread.id variants)
 * - langwatch.user.id (consolidated from legacy variants)
 * - langwatch.customer.id (consolidated from legacy variants)
 * - langwatch.rag.contexts (consolidated from legacy spellings)
 * - langwatch.params (passthrough)
 * - langwatch.input (with structured format unwrapping and array flattening)
 * - langwatch.output (with structured format unwrapping and array flattening)
 * - gen_ai.input.messages (from langwatch.input when type is "chat_messages")
 * - gen_ai.output.messages (from langwatch.output when type is "chat_messages" or "json")
 * - gen_ai.request.system_instruction (extracted from first system message)
 */

import { ATTR_KEYS } from "./_constants";
import {
  ALLOWED_SPAN_TYPES,
  extractSystemInstructionFromMessages,
  isRecord,
  normalizeToMessages,
  safeJsonParse,
} from "./_helpers";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

/**
 * Type guard for LangWatch SDK structured input/output format.
 * Used by DSPy and other frameworks that wrap messages in typed containers.
 */
interface LangWatchStructuredValue {
  type: string;
  value: unknown;
}

const isLangWatchStructuredValue = (
  v: unknown,
): v is LangWatchStructuredValue =>
  isRecord(v) &&
  "type" in v &&
  "value" in v &&
  typeof v.type === "string" &&
  v.value !== void 0;

export class LangWatchExtractor implements CanonicalAttributesExtractor {
  readonly id = "langwatch";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type (highest precedence)
    // Explicit langwatch.span.type takes priority
    // Note: May be upgraded to "llm" later if chat_messages input is detected
    // ─────────────────────────────────────────────────────────────────────────
    const spanType = attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (
      typeof spanType === "string" &&
      spanType.length > 0 &&
      ALLOWED_SPAN_TYPES.has(spanType)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, spanType);
      ctx.recordRule(`${this.id}:span.type`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Thread/Conversation ID → gen_ai.conversation.id
    // Consolidates multiple legacy naming conventions
    // ─────────────────────────────────────────────────────────────────────────
    const threadId =
      attrs.take(ATTR_KEYS.LANGWATCH_THREAD_ID) ??
      attrs.take(ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY) ??
      attrs.take(ATTR_KEYS.LANGWATCH_THREAD_ID_LEGACY_ROOT) ??
      attrs.take(ATTR_KEYS.LANGWATCH_LANGGRAPH_THREAD_ID);
    if (
      threadId !== undefined &&
      typeof threadId === "string" &&
      threadId.length > 0
    ) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_CONVERSATION_ID, threadId);
      ctx.recordRule(`${this.id}:conversation.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User ID (passthrough - not in GenAI spec yet)
    // Consolidates legacy naming conventions
    // ─────────────────────────────────────────────────────────────────────────
    const userId =
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID) ??
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY) ??
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT);
    if (userId !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_USER_ID, userId);
      ctx.recordRule(`${this.id}:user.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Customer ID (passthrough)
    // Consolidates legacy naming conventions
    // ─────────────────────────────────────────────────────────────────────────
    const customerId =
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID) ??
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY) ??
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY_ROOT);
    if (customerId !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, customerId);
      ctx.recordRule(`${this.id}:customer.id`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RAG Contexts
    // Accepts both current and legacy spellings
    // ─────────────────────────────────────────────────────────────────────────
    const ragContexts =
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS) ??
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY);
    if (ragContexts !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, ragContexts);
      ctx.recordRule(`${this.id}:rag.contexts`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Labels/Tags
    // SDK may send as langwatch.tags, normalize to langwatch.labels
    // ─────────────────────────────────────────────────────────────────────────
    const labels =
      attrs.take(ATTR_KEYS.LANGWATCH_LABELS) ??
      attrs.take(ATTR_KEYS.LANGWATCH_TAGS);
    if (labels !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_LABELS, labels);
      ctx.recordRule(`${this.id}:labels`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metadata JSON - Extract labels from metadata attribute
    // SDK may send labels inside a metadata JSON object: { labels: [...] }
    // Read without consuming so aggregation service can still access it
    // ─────────────────────────────────────────────────────────────────────────
    const metadataJson = attrs.get("metadata");
    if (typeof metadataJson === "string") {
      const parsed = safeJsonParse(metadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const parsedObj = parsed as Record<string, unknown>;
        // Extract labels if not already set
        if (Array.isArray(parsedObj.labels)) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.LANGWATCH_LABELS,
            JSON.stringify(parsedObj.labels),
          );
          ctx.recordRule(`${this.id}:metadata.labels`);
        }

        // Promote reserved metadata fields to canonical attributes.
        // Python SDK embeds user_id/thread_id/customer_id inside the JSON
        // blob rather than setting them as separate OTEL attributes.
        // Uses setAttrIfAbsent so explicit attributes take precedence.
        const metaUserId = parsedObj.user_id ?? parsedObj.userId;
        if (typeof metaUserId === "string" && metaUserId.length > 0) {
          ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, metaUserId);
          ctx.recordRule(`${this.id}:metadata.user_id`);
        }

        const metaThreadId = parsedObj.thread_id ?? parsedObj.threadId;
        if (typeof metaThreadId === "string" && metaThreadId.length > 0) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_CONVERSATION_ID,
            metaThreadId,
          );
          ctx.recordRule(`${this.id}:metadata.thread_id`);
        }

        const metaCustomerId = parsedObj.customer_id ?? parsedObj.customerId;
        if (typeof metaCustomerId === "string" && metaCustomerId.length > 0) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.LANGWATCH_CUSTOMER_ID,
            metaCustomerId,
          );
          ctx.recordRule(`${this.id}:metadata.customer_id`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Params (passthrough)
    // May be computed upstream
    // ─────────────────────────────────────────────────────────────────────────
    const params = attrs.take(ATTR_KEYS.LANGWATCH_PARAMS);
    if (params !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_PARAMS, params);
      ctx.recordRule(`${this.id}:params`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input (with structured format handling)
    // Handles: { type: "chat_messages", value: [...messages] } format
    // from DSPy and other frameworks
    // ─────────────────────────────────────────────────────────────────────────
    const rawInput = attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
    if (rawInput !== void 0) {
      const parsedInput = safeJsonParse(rawInput);

      if (isLangWatchStructuredValue(parsedInput)) {
        // Structured format: { type: "chat_messages", value: [...] }
        if (
          parsedInput.type === "chat_messages" &&
          Array.isArray(parsedInput.value)
        ) {
          // Use normalizeToMessages helper for consistent message handling
          const messages = normalizeToMessages(parsedInput.value, "user");

          if (messages) {
            // Set gen_ai.input.messages directly
            ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, messages);
            ctx.recordRule(
              `${this.id}:input.chat_messages->gen_ai.input.messages`,
            );

            // Extract system instruction using helper
            const systemInstruction =
              extractSystemInstructionFromMessages(messages);
            if (systemInstruction !== null) {
              ctx.setAttrIfAbsent(
                ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
                systemInstruction,
              );
            }

            // Upgrade span type to "llm" when we have chat messages input
            // This overrides the generic "span" type set earlier
            ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "llm");
            ctx.recordRule(`${this.id}:type=llm`);

            // Keep unwrapped messages for langwatch.input display
            ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput);
            ctx.recordRule(`${this.id}:input`);
          }
        } else {
          // Unknown structured type - keep as-is
          ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput);
          ctx.recordRule(`${this.id}:input`);
        }
      } else {
        // Legacy behavior: flatten single-element arrays
        const normalizedInput =
          Array.isArray(parsedInput) && parsedInput.length === 1
            ? parsedInput[0]
            : parsedInput;
        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, normalizedInput);
        ctx.recordRule(`${this.id}:input`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Output (with structured format handling)
    // Handles: { type: "json" | "chat_messages", value: [...] } format
    // from DSPy and other frameworks
    // ─────────────────────────────────────────────────────────────────────────
    const rawOutput = attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
    if (rawOutput !== undefined) {
      const parsedOutput = safeJsonParse(rawOutput);

      if (isLangWatchStructuredValue(parsedOutput)) {
        // Structured format: { type: "...", value: [...] }
        if (
          parsedOutput.type === "chat_messages" &&
          Array.isArray(parsedOutput.value)
        ) {
          // Use normalizeToMessages helper for consistent message handling
          const messages = normalizeToMessages(parsedOutput.value, "assistant");

          if (messages && messages.length > 0) {
            // Chat messages output - map directly to gen_ai.output.messages
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
            ctx.recordRule(
              `${this.id}:output.chat_messages->gen_ai.output.messages`,
            );

            // Keep unwrapped messages for langwatch.output display
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, messages);
            ctx.recordRule(`${this.id}:output`);
          }
        } else if (
          parsedOutput.type === "json" &&
          Array.isArray(parsedOutput.value)
        ) {
          // JSON output (e.g., from DSPy) - wrap as assistant message
          const content = parsedOutput.value
            .map((item) =>
              typeof item === "string" ? item : JSON.stringify(item),
            )
            .join("\n");

          // Use normalizeToMessages for consistent output format
          const messages = normalizeToMessages(content, "assistant");
          if (messages && messages.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
            ctx.recordRule(`${this.id}:output.json->gen_ai.output.messages`);
          }

          // Keep joined content for langwatch.output display
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput);
          ctx.recordRule(`${this.id}:output`);
        } else {
          // Unknown structured type - keep as-is
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput);
          ctx.recordRule(`${this.id}:output`);
        }
      } else {
        // Legacy behavior: flatten single-element arrays
        const normalizedOutput =
          Array.isArray(parsedOutput) && parsedOutput.length === 1
            ? parsedOutput[0]
            : parsedOutput;
        ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, normalizedOutput);
        ctx.recordRule(`${this.id}:output`);
      }
    }
  }
}
