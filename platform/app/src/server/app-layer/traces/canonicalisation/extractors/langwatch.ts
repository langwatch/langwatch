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
 * - langwatch.span.type (passthrough)
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

import type { NormalizedEvent } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "./_constants";
import { ALLOWED_SPAN_TYPES } from "./_extraction";
import { isRecord } from "./_guards";
import {
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripSystemMessages,
} from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

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

/**
 * Strips trailing `assistant` messages from a chat_messages array.
 *
 * Per OTel GenAI spec, `gen_ai.input.messages` is the prompt array sent to
 * the model — the final message is always `user`, `system`, or `tool`,
 * never `assistant`. Some SDKs capture span attributes after the model has
 * returned, and at that point the response message has been appended to
 * the conversation state, so it leaks into `input` (where it then
 * duplicates `output`).
 *
 * Drop any tail of `assistant` messages so input reflects what was actually
 * sent to the model. Multi-turn history with prior `assistant` messages
 * earlier in the array is preserved.
 */
function stripTrailingAssistantMessages(messages: unknown[]): unknown[] {
  let end = messages.length;
  while (end > 0) {
    const last = messages[end - 1];
    if (isRecord(last) && (last as { role?: unknown }).role === "assistant") {
      end--;
    } else {
      break;
    }
  }
  return end === messages.length ? messages : messages.slice(0, end);
}

export class LangWatchExtractor implements CanonicalAttributesExtractor {
  readonly id = "langwatch";

  // ─────────────────────────────────────────────────────────────────────────
  // Span Type (highest precedence)
  // Explicit langwatch.span.type takes priority
  // ─────────────────────────────────────────────────────────────────────────
  private setSpanType(ctx: ExtractorContext): void {
    const spanType = ctx.bag.attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (
      typeof spanType === "string" &&
      spanType.length > 0 &&
      ALLOWED_SPAN_TYPES.has(spanType)
    ) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, spanType);
      ctx.recordRule(`${this.id}:span.type`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Thread/Conversation ID → gen_ai.conversation.id
  // Consolidates multiple legacy naming conventions
  // ─────────────────────────────────────────────────────────────────────────
  private setThreadId(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
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
  }

  // ─────────────────────────────────────────────────────────────────────────
  // User ID (passthrough - not in GenAI spec yet)
  // Consolidates legacy naming conventions
  // ─────────────────────────────────────────────────────────────────────────
  private setUserId(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const userId =
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID) ??
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY) ??
      attrs.take(ATTR_KEYS.LANGWATCH_USER_ID_LEGACY_ROOT);
    if (userId !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_USER_ID, userId);
      ctx.recordRule(`${this.id}:user.id`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Customer ID (passthrough)
  // Consolidates legacy naming conventions
  // ─────────────────────────────────────────────────────────────────────────
  private setCustomerId(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const customerId =
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID) ??
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY) ??
      attrs.take(ATTR_KEYS.LANGWATCH_CUSTOMER_ID_LEGACY_ROOT);
    if (customerId !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, customerId);
      ctx.recordRule(`${this.id}:customer.id`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RAG Contexts
  // Accepts both current and legacy spellings
  // ─────────────────────────────────────────────────────────────────────────
  private setRagContexts(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const ragContexts =
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS) ??
      attrs.take(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY);
    if (ragContexts !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, ragContexts);
      ctx.recordRule(`${this.id}:rag.contexts`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Labels/Tags
  // SDK may send as langwatch.tags, normalize to langwatch.labels
  // ─────────────────────────────────────────────────────────────────────────
  private setLabels(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const labels =
      attrs.take(ATTR_KEYS.LANGWATCH_LABELS) ??
      attrs.take(ATTR_KEYS.LANGWATCH_TAGS);
    if (labels !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_LABELS, labels);
      ctx.recordRule(`${this.id}:labels`);
    }
  }

  // Promote reserved metadata fields to canonical attributes.
  // Python SDK embeds user_id/thread_id/customer_id inside the JSON
  // blob rather than setting them as separate OTEL attributes.
  // Uses setAttrIfAbsent so explicit attributes take precedence.
  private applyMetadataObject(
    ctx: ExtractorContext,
    parsedObj: Record<string, unknown>,
  ): void {
    // Extract labels if not already set
    if (Array.isArray(parsedObj.labels)) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_LABELS, [...parsedObj.labels]);
      ctx.recordRule(`${this.id}:metadata.labels`);
    }

    const metaUserId = parsedObj.user_id ?? parsedObj.userId;
    if (typeof metaUserId === "string" && metaUserId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, metaUserId);
      ctx.recordRule(`${this.id}:metadata.user_id`);
    }

    const metaThreadId = parsedObj.thread_id ?? parsedObj.threadId;
    if (typeof metaThreadId === "string" && metaThreadId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, metaThreadId);
      ctx.recordRule(`${this.id}:metadata.thread_id`);
    }

    const metaCustomerId = parsedObj.customer_id ?? parsedObj.customerId;
    if (typeof metaCustomerId === "string" && metaCustomerId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, metaCustomerId);
      ctx.recordRule(`${this.id}:metadata.customer_id`);
    }

    this.hoistMetadataFields(ctx, parsedObj);
    ctx.recordRule(`${this.id}:metadata.hoisted`);
  }

  // Hoist remaining custom metadata fields as metadata.{key} canonical
  // attributes so they are available as first-class trace summary attrs.
  private hoistMetadataFields(
    ctx: ExtractorContext,
    parsedObj: Record<string, unknown>,
  ): void {
    const RESERVED_METADATA_KEYS = new Set([
      "labels",
      "user_id",
      "userId",
      "thread_id",
      "threadId",
      "customer_id",
      "customerId",
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
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata JSON - Extract and hoist all metadata fields
  // SDK may send labels, reserved fields, and custom metadata inside a
  // metadata JSON object. Consume the blob with take() and hoist every
  // field so downstream code uses canonical keys only.
  // ─────────────────────────────────────────────────────────────────────────
  private applyMetadataBlob(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const metadata =
      attrs.take("metadata") ??
      attrs.take("langwatch.metadata") ??
      attrs.take("langwatch.trace");
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      this.applyMetadataObject(ctx, metadata as Record<string, unknown>);
      return;
    }
    if (metadata !== undefined && metadata !== null) {
      // Invalid metadata (string, array, number) — store as metadata._raw
      ctx.setAttrIfAbsent(
        "metadata._raw",
        typeof metadata === "string" ? metadata : safeStringify(metadata),
      );
      ctx.recordRule(`${this.id}:metadata._raw`);
    }
  }

  private applyMetadataSubkeyPrefix(
    ctx: ExtractorContext,
    prefix: string,
  ): void {
    for (const { key, value } of ctx.bag.attrs.takeByPrefix(prefix)) {
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
  // Metadata subkeys — consume langwatch.metadata.* and langwatch.trace.*
  // subkeys and normalize to metadata.{bareKey}.
  // Uses setAttr (not setAttrIfAbsent) so subkeys override blob fields.
  // ─────────────────────────────────────────────────────────────────────────
  private applyMetadataSubkeys(ctx: ExtractorContext): void {
    const METADATA_SUBKEY_PREFIXES = [
      "langwatch.metadata.",
      "langwatch.trace.",
    ] as const;
    for (const prefix of METADATA_SUBKEY_PREFIXES) {
      this.applyMetadataSubkeyPrefix(ctx, prefix);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Params (passthrough)
  // May be computed upstream
  // ─────────────────────────────────────────────────────────────────────────
  private setParams(ctx: ExtractorContext): void {
    const params = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_PARAMS);
    if (params !== undefined) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_PARAMS, params);
      ctx.recordRule(`${this.id}:params`);
    }
  }

  private applyLegacyInput(ctx: ExtractorContext, rawInput: unknown): void {
    // Legacy behavior: flatten single-element arrays
    const normalizedInput =
      Array.isArray(rawInput) && rawInput.length === 1 ? rawInput[0] : rawInput;
    ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, normalizedInput);
    ctx.recordRule(`${this.id}:input`);
  }

  private applyChatMessagesInput(
    ctx: ExtractorContext,
    rawInput: LangWatchStructuredValue,
    value: unknown[],
  ): void {
    // Strip trailing assistant messages — these are the model's
    // response leaking back into input from post-call attribute
    // capture, not part of what was actually sent.
    const cleanedValue = stripTrailingAssistantMessages(value);
    const messages = normalizeToMessages(cleanedValue, "user");

    if (messages) {
      const systemInstruction = extractSystemInstructionFromMessages(messages);
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
      ctx.recordRule(`${this.id}:input.chat_messages->gen_ai.input.messages`);
    }

    // Preserve the (cleaned) raw input
    ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, {
      ...rawInput,
      value: cleanedValue,
    });
    ctx.recordRule(`${this.id}:input`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input (with structured format handling)
  // Handles: { type: "chat_messages" | "text" | "json" | ..., value: ... }
  // from DSPy and other frameworks.
  // ─────────────────────────────────────────────────────────────────────────
  private applyInput(ctx: ExtractorContext, reservedTypes: string[]): void {
    const rawInput = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_INPUT);
    if (rawInput === void 0) return;

    if (!isLangWatchStructuredValue(rawInput)) {
      this.applyLegacyInput(ctx, rawInput);
      return;
    }

    reservedTypes.push(`${ATTR_KEYS.LANGWATCH_INPUT}=${rawInput.type}`);

    if (rawInput.type === "chat_messages" && Array.isArray(rawInput.value)) {
      this.applyChatMessagesInput(ctx, rawInput, rawInput.value);
    } else {
      // text, json, raw, list — unwrap value, don't coerce to gen_ai
      ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, rawInput.value);
      ctx.recordRule(`${this.id}:input`);
    }
  }

  private applyLegacyOutput(ctx: ExtractorContext, rawOutput: unknown): void {
    // Legacy behavior: flatten single-element arrays
    const normalizedOutput =
      Array.isArray(rawOutput) && rawOutput.length === 1
        ? rawOutput[0]
        : rawOutput;
    ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, normalizedOutput);
    ctx.recordRule(`${this.id}:output`);
  }

  private applyChatMessagesOutput(
    ctx: ExtractorContext,
    value: unknown[],
  ): void {
    const messages = normalizeToMessages(value, "assistant");

    if (messages && messages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
      ctx.recordRule(`${this.id}:output.chat_messages->gen_ai.output.messages`);
    }

    // Always preserve raw output — even when normalization fails
    ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, value);
    ctx.recordRule(`${this.id}:output`);
  }

  private applyJsonArrayOutput(ctx: ExtractorContext, value: unknown[]): void {
    const content = value
      .map((item) => (typeof item === "string" ? item : safeStringify(item)))
      .join("\n");

    const messages = normalizeToMessages(content, "assistant");
    if (messages && messages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
      ctx.recordRule(`${this.id}:output.json->gen_ai.output.messages`);
    }

    // Store unwrapped value in langwatch.output
    ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, value);
    ctx.recordRule(`${this.id}:output`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Output (with structured format handling)
  // ─────────────────────────────────────────────────────────────────────────
  private applyOutput(ctx: ExtractorContext, reservedTypes: string[]): void {
    const rawOutput = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_OUTPUT);
    if (rawOutput === undefined) return;

    if (!isLangWatchStructuredValue(rawOutput)) {
      this.applyLegacyOutput(ctx, rawOutput);
      return;
    }

    reservedTypes.push(`${ATTR_KEYS.LANGWATCH_OUTPUT}=${rawOutput.type}`);

    if (rawOutput.type === "chat_messages" && Array.isArray(rawOutput.value)) {
      this.applyChatMessagesOutput(ctx, rawOutput.value);
    } else if (rawOutput.type === "json" && Array.isArray(rawOutput.value)) {
      this.applyJsonArrayOutput(ctx, rawOutput.value);
    } else {
      // text, raw, list — unwrap value, don't coerce to gen_ai
      ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, rawOutput.value);
      ctx.recordRule(`${this.id}:output`);
    }
  }

  // Type info is collected and stored in langwatch.reserved.types.
  private applyInputOutput(ctx: ExtractorContext): void {
    const reservedTypes: string[] = [];

    this.applyInput(ctx, reservedTypes);
    this.applyOutput(ctx, reservedTypes);

    // Store collected type information as a string array
    if (reservedTypes.length > 0) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_VALUE_TYPES, reservedTypes);
      ctx.recordRule(`${this.id}:reserved.value_types`);
    }
  }

  private setMetricIfPositive({
    ctx,
    value,
    key,
    ruleSuffix,
  }: {
    ctx: ExtractorContext;
    value: number | null;
    key: string;
    ruleSuffix: string;
  }): void {
    if (value !== null && value > 0) {
      ctx.setAttrIfAbsent(key, value);
      ctx.recordRule(`${this.id}:${ruleSuffix}`);
    }
  }

  private setMetricIfNonNegative({
    ctx,
    value,
    key,
    ruleSuffix,
  }: {
    ctx: ExtractorContext;
    value: number | null;
    key: string;
    ruleSuffix: string;
  }): void {
    if (value !== null && value >= 0) {
      ctx.setAttrIfAbsent(key, value);
      ctx.recordRule(`${this.id}:${ruleSuffix}`);
    }
  }

  private applyMetricsFields(
    ctx: ExtractorContext,
    metricsValue: Record<string, unknown>,
  ): void {
    const numberField = (...keys: string[]): number | null => {
      for (const key of keys) {
        const value = metricsValue[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
      }
      return null;
    };

    // Token counts (setAttrIfAbsent — GenAI extractor may have set these)
    this.setMetricIfPositive({
      ctx,
      value: numberField("promptTokens", "prompt_tokens"),
      key: ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
      ruleSuffix: "metrics.promptTokens",
    });

    this.setMetricIfPositive({
      ctx,
      value: numberField("completionTokens", "completion_tokens"),
      key: ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
      ruleSuffix: "metrics.completionTokens",
    });

    this.setMetricIfPositive({
      ctx,
      value: numberField("reasoningTokens", "reasoning_tokens"),
      key: ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
      ruleSuffix: "metrics.reasoningTokens",
    });

    // Cost (setAttrIfAbsent — custom cost rates from enrichment take precedence)
    this.setMetricIfPositive({
      ctx,
      value: numberField("cost"),
      key: ATTR_KEYS.LANGWATCH_SPAN_COST,
      ruleSuffix: "metrics.cost",
    });

    // Time to first token, already a duration in milliseconds
    this.setMetricIfNonNegative({
      ctx,
      value: numberField("firstTokenMs", "first_token_ms"),
      key: ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN,
      ruleSuffix: "metrics.firstTokenMs",
    });

    // Estimated flag
    const tokensEstimated =
      metricsValue.tokensEstimated ?? metricsValue.tokens_estimated;
    if (tokensEstimated === true) {
      ctx.setAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, true);
      ctx.recordRule(`${this.id}:metrics.tokensEstimated`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics (cost, tokens, reasoning, TTFT, estimated flag)
  // Two SDK shapes for the same attribute:
  // - TypeScript: { type: "json", value: { promptTokens, completionTokens, cost } }
  // - Python: bare snake_case object { prompt_tokens, completion_tokens,
  //   reasoning_tokens, cost, first_token_ms }
  // ─────────────────────────────────────────────────────────────────────────
  private applyMetrics(ctx: ExtractorContext): void {
    const rawMetrics = ctx.bag.attrs.take(ATTR_KEYS.LANGWATCH_METRICS);
    if (rawMetrics === undefined) return;

    const metricsValue: Record<string, unknown> | null =
      isLangWatchStructuredValue(rawMetrics) && isRecord(rawMetrics.value)
        ? (rawMetrics.value as Record<string, unknown>)
        : isRecord(rawMetrics)
          ? (rawMetrics as Record<string, unknown>)
          : null;

    if (metricsValue) {
      this.applyMetricsFields(ctx, metricsValue);
    }
  }

  // Map first evaluation to OTel GenAI evaluation semconv attributes
  private applyEvaluationEventData(
    ctx: ExtractorContext,
    evalData: Record<string, unknown>,
  ): void {
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
  }

  // Attempts to apply a single event as the evaluation.custom mapping.
  // Returns true when applied (the caller stops after the first match).
  private tryApplyEvaluationEvent(
    ctx: ExtractorContext,
    event: NormalizedEvent,
  ): boolean {
    if (event.name !== "langwatch.evaluation.custom") return false;

    const eventAttrs = (event.attributes ?? {}) as Record<string, unknown>;
    const jsonPayload = eventAttrs.json_encoded_event;
    if (jsonPayload === undefined || jsonPayload === null) return false;

    try {
      // json_encoded_event may be a string (raw OTLP) or already parsed
      // by normalizeOtlpAttributes' parseJsonStringValues step
      const parsed =
        typeof jsonPayload === "string" ? JSON.parse(jsonPayload) : jsonPayload;
      if (!isRecord(parsed)) return false;

      this.applyEvaluationEventData(ctx, parsed as Record<string, unknown>);
      ctx.recordRule(`${this.id}:evaluation.custom`);
      return true;
    } catch {
      // skip malformed events
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Evaluation Events (langwatch.evaluation.custom) → GenAI semconv
  // SDK sends span events with name "langwatch.evaluation.custom".
  // The reactor reads these directly from the OTLP span events to sync
  // to evaluation_runs. Here we only map to GenAI semconv span attributes.
  // ─────────────────────────────────────────────────────────────────────────
  private applyEvaluationEvents(ctx: ExtractorContext): void {
    for (const event of ctx.bag.events.all()) {
      // Only first evaluation maps to semconv
      if (this.tryApplyEvaluationEvent(ctx, event)) break;
    }
  }

  apply(ctx: ExtractorContext): void {
    this.setSpanType(ctx);
    this.setThreadId(ctx);
    this.setUserId(ctx);
    this.setCustomerId(ctx);
    this.setRagContexts(ctx);
    this.setLabels(ctx);
    this.applyMetadataBlob(ctx);
    this.applyMetadataSubkeys(ctx);
    this.setParams(ctx);
    this.applyInputOutput(ctx);
    this.applyMetrics(ctx);
    this.applyEvaluationEvents(ctx);
  }
}
