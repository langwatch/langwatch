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
 * - gen_ai.system_instructions (extracted from first system message)
 */

import { createLogger } from "~/utils/logger/server";
import { ATTR_KEYS } from "./_constants";
import { ALLOWED_SPAN_TYPES } from "./_extraction";
import { isRecord } from "./_guards";
import {
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripSystemMessages,
} from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

const logger = createLogger("langwatch:trace-processing:langwatch-extractor");

/** JSON.stringify that never throws — returns a fallback on circular refs / BigInt / etc. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

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
    // Metadata JSON - Extract and hoist all metadata fields
    // SDK may send labels, reserved fields, and custom metadata inside a
    // metadata JSON object. Consume the blob with take() and hoist every
    // field so downstream code uses canonical keys only.
    // ─────────────────────────────────────────────────────────────────────────
    const metadata = attrs.take("metadata") ?? attrs.take("langwatch.metadata")
      ?? attrs.take("trace") ?? attrs.take("langwatch.trace");
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const parsedObj = metadata as Record<string, unknown>;
        // Extract labels if not already set
        if (Array.isArray(parsedObj.labels)) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.LANGWATCH_LABELS,
            [...parsedObj.labels],
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

        // Hoist remaining custom metadata fields as metadata.{key} canonical
        // attributes so they are available as first-class trace summary attrs.
        const RESERVED_METADATA_KEYS = new Set([
          "labels",
          "user_id", "userId",
          "thread_id", "threadId",
          "customer_id", "customerId",
        ]);
        for (const [key, value] of Object.entries(parsedObj)) {
          if (RESERVED_METADATA_KEYS.has(key)) continue;
          if (value !== null && value !== undefined) {
            ctx.setAttrIfAbsent(
              `metadata.${key}`,
              typeof value === "string" ? value : safeStringify(value),
            );
          }
        }
        ctx.recordRule(`${this.id}:metadata.hoisted`);
    } else if (metadata !== undefined && metadata !== null) {
        // Invalid metadata (string, array, number) — store as metadata._raw
        ctx.setAttrIfAbsent(
          "metadata._raw",
          typeof metadata === "string" ? metadata : safeStringify(metadata),
        );
        ctx.recordRule(`${this.id}:metadata._raw`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metadata subkeys — consume langwatch.metadata.*, langwatch.trace.*,
    // and trace.* subkeys and normalize to metadata.{bareKey}.
    // Uses setAttr (not setAttrIfAbsent) so subkeys override blob fields.
    // ─────────────────────────────────────────────────────────────────────────
    const METADATA_SUBKEY_PREFIXES = [
      "langwatch.metadata.",
      "langwatch.trace.",
      "trace.",
    ] as const;
    for (const prefix of METADATA_SUBKEY_PREFIXES) {
      for (const { key, value } of attrs.takeByPrefix(prefix)) {
        const bareKey = key.slice(prefix.length);
        if (bareKey && value !== null && value !== undefined) {
          ctx.setAttr(
            `metadata.${bareKey}`,
            typeof value === "string" ? value : safeStringify(value),
          );
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
    // Input & Output (with structured format handling)
    // Handles: { type: "chat_messages" | "text" | "json" | ..., value: ... }
    // from DSPy and other frameworks.
    // Type info is collected and stored in langwatch.reserved.types.
    // ─────────────────────────────────────────────────────────────────────────
    const reservedTypes: string[] = [];

    const rawInput = attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
    if (rawInput !== void 0) {
      if (isLangWatchStructuredValue(rawInput)) {
        reservedTypes.push(
          `${ATTR_KEYS.LANGWATCH_INPUT}=${rawInput.type}`,
        );

        if (
          rawInput.type === "chat_messages" &&
          Array.isArray(rawInput.value)
        ) {
          const messages = normalizeToMessages(rawInput.value, "user");

          if (messages) {
            const systemInstruction =
              extractSystemInstructionFromMessages(messages);
            if (systemInstruction !== null) {
              ctx.setAttrIfAbsent(
                ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS,
                systemInstruction,
              );
            }

            // Strip system messages — they are promoted to gen_ai.system_instructions
            const chatMsgs = systemInstruction
              ? stripSystemMessages(messages)
              : messages;
            if (chatMsgs.length > 0) {
              ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMsgs);
            }
            ctx.recordRule(
              `${this.id}:input.chat_messages->gen_ai.input.messages`,
            );

            ctx.setAttr(ATTR_KEYS.SPAN_TYPE, "llm");
            ctx.recordRule(`${this.id}:type=llm`);
          }

          // Always preserve the raw input — even when normalization fails
          ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput);
          ctx.recordRule(`${this.id}:input`);
        } else {
          // text, json, raw, list — unwrap value, don't coerce to gen_ai
          ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput.value);
          ctx.recordRule(`${this.id}:input`);
        }
      } else {
        // Legacy behavior: flatten single-element arrays
        const normalizedInput =
          Array.isArray(rawInput) && rawInput.length === 1
            ? rawInput[0]
            : rawInput;
        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, normalizedInput);
        ctx.recordRule(`${this.id}:input`);
      }
    }

    const rawOutput = attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
    if (rawOutput !== undefined) {
      if (isLangWatchStructuredValue(rawOutput)) {
        reservedTypes.push(
          `${ATTR_KEYS.LANGWATCH_OUTPUT}=${rawOutput.type}`,
        );

        if (
          rawOutput.type === "chat_messages" &&
          Array.isArray(rawOutput.value)
        ) {
          const messages = normalizeToMessages(rawOutput.value, "assistant");

          if (messages && messages.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
            ctx.recordRule(
              `${this.id}:output.chat_messages->gen_ai.output.messages`,
            );
          }

          // Always preserve raw output — even when normalization fails
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
          ctx.recordRule(`${this.id}:output`);
        } else if (
          rawOutput.type === "json" &&
          Array.isArray(rawOutput.value)
        ) {
          const content = (rawOutput.value as unknown[])
            .map((item) =>
              typeof item === "string" ? item : safeStringify(item),
            )
            .join("\n");

          const messages = normalizeToMessages(content, "assistant");
          if (messages && messages.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
            ctx.recordRule(`${this.id}:output.json->gen_ai.output.messages`);
          }

          // Store unwrapped value in langwatch.output
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
          ctx.recordRule(`${this.id}:output`);
        } else {
          // text, raw, list — unwrap value, don't coerce to gen_ai
          ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
          ctx.recordRule(`${this.id}:output`);
        }
      } else {
        // Legacy behavior: flatten single-element arrays
        const normalizedOutput =
          Array.isArray(rawOutput) && rawOutput.length === 1
            ? rawOutput[0]
            : rawOutput;
        ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, normalizedOutput);
        ctx.recordRule(`${this.id}:output`);
      }
    }

    // Store collected type information as a string array
    if (reservedTypes.length > 0) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES, reservedTypes);
      ctx.recordRule(`${this.id}:reserved.value_types`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metrics (cost, tokens, estimated flag)
    // SDK sends: { type: "json", value: { promptTokens, completionTokens, cost } }
    // ─────────────────────────────────────────────────────────────────────────
    const rawMetrics = attrs.take(ATTR_KEYS.LANGWATCH_METRICS);
    if (rawMetrics !== undefined) {
      if (isLangWatchStructuredValue(rawMetrics) && isRecord(rawMetrics.value)) {
        const metricsValue = rawMetrics.value as Record<string, unknown>;

        // Extract token counts (setAttrIfAbsent — GenAI extractor may have set these)
        const promptTokens = metricsValue.promptTokens;
        if (typeof promptTokens === "number" && promptTokens > 0) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
            promptTokens,
          );
          ctx.recordRule(`${this.id}:metrics.promptTokens`);
        }

        const completionTokens = metricsValue.completionTokens;
        if (typeof completionTokens === "number" && completionTokens > 0) {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
            completionTokens,
          );
          ctx.recordRule(`${this.id}:metrics.completionTokens`);
        }

        // Extract cost (setAttrIfAbsent — custom cost rates from enrichment take precedence)
        const cost = metricsValue.cost;
        if (typeof cost === "number" && cost > 0) {
          ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_SPAN_COST, cost);
          ctx.recordRule(`${this.id}:metrics.cost`);
        }

        // Extract estimated flag
        const tokensEstimated = metricsValue.tokensEstimated;
        if (tokensEstimated === true) {
          ctx.setAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, true);
          ctx.recordRule(`${this.id}:metrics.tokensEstimated`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Evaluation Events (langwatch.evaluation.custom) → GenAI semconv
    // SDK sends span events with name "langwatch.evaluation.custom".
    // The reactor reads these directly from the OTLP span events to sync
    // to evaluation_runs. Here we only map to GenAI semconv span attributes.
    // ─────────────────────────────────────────────────────────────────────────
    for (const event of ctx.bag.events.all()) {
      if (event.name !== "langwatch.evaluation.custom") continue;

      const eventAttrs = (event.attributes ?? {}) as Record<string, unknown>;
      const jsonPayload = eventAttrs.json_encoded_event;
      if (jsonPayload === undefined || jsonPayload === null) continue;

      try {
        // json_encoded_event may be a string (raw OTLP) or already parsed
        // by normalizeOtlpAttributes' parseJsonStringValues step
        const parsed =
          typeof jsonPayload === "string"
            ? JSON.parse(jsonPayload)
            : jsonPayload;
        if (!isRecord(parsed)) continue;

        const evalData = parsed as Record<string, unknown>;

        // Map first evaluation to OTel GenAI evaluation semconv attributes
        if (typeof evalData.name === "string") {
          ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_EVALUATION_NAME, evalData.name);
        }
        if (typeof evalData.label === "string") {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL,
            evalData.label,
          );
        }
        if (typeof evalData.score === "number") {
          ctx.setAttrIfAbsent(
            ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE,
            evalData.score,
          );
        }
        ctx.recordRule(`${this.id}:evaluation.custom`);
        break; // Only first evaluation maps to semconv
      } catch {
        // skip malformed events
      }
    }
  }
}
