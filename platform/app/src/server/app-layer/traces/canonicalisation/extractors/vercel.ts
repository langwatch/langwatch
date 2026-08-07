/**
 * Vercel AI SDK Extractor
 *
 * Handles: Vercel AI SDK telemetry (ai.* namespace)
 * Reference: https://sdk.vercel.ai/docs/ai-sdk-core/telemetry
 *
 * The Vercel AI SDK uses its own attribute namespace and formats that differ
 * from OTel GenAI conventions. This extractor normalises those to canonical
 * attributes.
 *
 * Detection: Presence of ai.prompt, ai.prompt.messages, ai.response,
 * ai.response.text, ai.response.object, ai.model, or ai.usage attributes
 *
 * Canonical attributes produced:
 * - langwatch.span.type (llm / tool)
 * - gen_ai.request.model / gen_ai.response.model (from ai.model)
 * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens (from ai.usage)
 * - gen_ai.input.messages (from ai.prompt / ai.prompt.messages)
 * - gen_ai.output.messages (from ai.response / ai.response.text / ai.response.object)
 * - gen_ai.tool.name + langwatch.input/output (from ai.toolCall.* on tool spans)
 *
 * Special handling:
 * - ai.model is an object with { id, provider } structure
 * - ai.usage contains { promptTokens, completionTokens }
 * - ai.response may contain toolCalls array
 * - ai.toolCall spans carry ai.toolCall.{name,args,result} for the call
 * - span.name is mapped to langwatch.span.type
 */

import { ATTR_KEYS } from "./_constants";
import {
  extractModelToBoth,
  extractUsageTokens,
  normaliseModelFromAiModelObject,
  recordValueType,
} from "./_extraction";
import { asNumber, isNonEmptyString, isRecord } from "./_guards";
import { extractSystemInstructionFromMessages } from "./_messages";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

const AI_SDK_SPAN_TYPE_MAP: Record<string, string> = {
  // Text generation spans
  "ai.generateText": "llm",
  "ai.streamText": "llm",
  "ai.generateObject": "llm",
  "ai.streamObject": "llm",

  // Provider-level spans
  "ai.generateText.doGenerate": "llm",
  "ai.streamText.doStream": "llm",
  "ai.generateObject.doGenerate": "llm",
  "ai.streamObject.doStream": "llm",

  // Tool execution spans
  "ai.toolCall": "tool",

  // Embedding spans
  "ai.embed": "component",
  "ai.embedMany": "component",
  "ai.embed.doEmbed": "component",
  "ai.embedMany.doEmbed": "component",
} as const;

export class VercelExtractor implements CanonicalAttributesExtractor {
  readonly id = "vercel";

  // Trigger when Vercel AI SDK signals are present. The SDK's own
  // OTel resource emits with instrumentationScope.name === "ai",
  // but downstream embedders (opencode, custom Vercel-SDK wrappers)
  // re-export those same spans under their own scope while keeping
  // the ai.* attribute shape intact. Gate on either signal so the
  // input/output message lift runs for both — cost/model already
  // ride on gen_ai.* attrs that the SDK emits alongside ai.* and
  // SpanCostService reads independently, but ai.prompt.messages →
  // gen_ai.input.messages translation lives only here, so a missed
  // gate leaves ComputedInput/ComputedOutput NULL on the receiver.
  private isVercelSpan(ctx: ExtractorContext): boolean {
    const { attrs } = ctx.bag;
    const scopeMatches = ctx.span.instrumentationScope.name === "ai";
    const attrsMatch =
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_PROMPT_MESSAGES) ||
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE_TEXT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE_OBJECT) ||
      attrs.has(ATTR_KEYS.AI_USAGE) ||
      // AI SDK v5 emits usage as flat-dotted attributes rather than the
      // ai.usage object, and embedders (opencode) re-export under their own
      // scope — so the flat usage keys are the only reliable signal there.
      attrs.has(ATTR_KEYS.AI_USAGE_INPUT_TOKENS) ||
      attrs.has(ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS) ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME);
    return scopeMatches || attrsMatch;
  }

  // Vercel AI SDK spans are LLM spans
  private setSpanType(ctx: ExtractorContext): void {
    const proposedSpanType = AI_SDK_SPAN_TYPE_MAP[ctx.span.name];
    if (proposedSpanType) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
      ctx.recordRule(`${this.id}:span.name->langwatch.span.type`);
    }
  }

  // ai.model is an object: { id: "gpt-4", provider: "openai.chat" }
  // Normalized to "openai/gpt-4" format
  private liftModel(ctx: ExtractorContext): void {
    if (
      !extractModelToBoth({
        ctx,
        sourceKey: ATTR_KEYS.AI_MODEL,
        transform: (raw) => normaliseModelFromAiModelObject(raw),
        ruleId: `${this.id}:ai.model->gen_ai.*.model`,
      })
    ) {
      // Consume attribute even if not used, to reduce leftovers
      ctx.bag.attrs.take(ATTR_KEYS.AI_MODEL);
    }
  }

  // ai.usage contains { promptTokens, completionTokens }
  private liftUsageTokens(ctx: ExtractorContext): void {
    extractUsageTokens(
      ctx,
      { object: ATTR_KEYS.AI_USAGE },
      `${this.id}:ai.usage->gen_ai.usage`,
    );
  }

  private liftCacheReadTokens(
    ctx: ExtractorContext,
    cacheRead: number | null,
  ): void {
    if (cacheRead === null || cacheRead <= 0) return;
    ctx.setAttrIfAbsent(
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      cacheRead,
    );
    ctx.recordRule(`${this.id}:ai.usage.cacheRead->gen_ai.usage.cache_read`);
  }

  private liftCacheWriteTokens(
    ctx: ExtractorContext,
    cacheWrite: number | null,
  ): void {
    if (cacheWrite === null || cacheWrite <= 0) return;
    ctx.setAttrIfAbsent(
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
      cacheWrite,
    );
    ctx.recordRule(
      `${this.id}:ai.usage.cacheWrite->gen_ai.usage.cache_creation`,
    );
  }

  // The AI SDK's input count is the FULL prompt total, cache included.
  // The canonical convention is the opposite: gen_ai.usage.input_tokens
  // is the fresh, non-cached remainder, with cache read/write counted
  // separately — so totals and cost sum the buckets without counting
  // the cached share twice. Rewrite to the fresh remainder: the SDK's
  // own noCacheTokens when present, else total minus the cache buckets.
  private rewriteFreshInputTokens({
    ctx,
    canonicalInput,
    cacheRead,
    cacheWrite,
    noCacheTokens,
  }: {
    ctx: ExtractorContext;
    canonicalInput: number;
    cacheRead: number | null;
    cacheWrite: number | null;
    noCacheTokens: number | null;
  }): void {
    if ((cacheRead ?? 0) <= 0 && (cacheWrite ?? 0) <= 0) return;
    const freshInput =
      noCacheTokens ??
      Math.max(0, canonicalInput - (cacheRead ?? 0) - (cacheWrite ?? 0));
    if (freshInput === canonicalInput) return;
    ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, freshInput);
    ctx.recordRule(
      `${this.id}:ai.usage.inputTokens->gen_ai.usage.input_tokens(fresh)`,
    );
  }

  private liftReasoningTokens(ctx: ExtractorContext): void {
    const reasoningTokens = asNumber(
      ctx.bag.attrs.take(ATTR_KEYS.AI_USAGE_REASONING_TOKENS),
    );
    if (reasoningTokens === null || reasoningTokens <= 0) return;
    ctx.setAttrIfAbsent(
      ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
      reasoningTokens,
    );
    ctx.recordRule(
      `${this.id}:ai.usage.reasoningTokens->gen_ai.usage.reasoning_tokens`,
    );
  }

  // Cache + reasoning token details. The AI SDK reports these as
  // flat-dotted attributes (ai.usage.inputTokenDetails.cache{Read,Write}
  // Tokens with ai.usage.cachedInputTokens as the older read alias,
  // ai.usage.reasoningTokens) rather than the gen_ai.usage.* convention,
  // so map them here. Without this an opencode cache-creation turn (12k+
  // tokens) goes uncounted. Only the span that already carries the
  // canonical input count gets the mapping: the AI SDK stamps the same
  // ai.usage.* rollup on the parent span (ai.streamText) AND the provider
  // call (ai.streamText.doStream), but only the provider call carries
  // gen_ai.usage.input_tokens — mapping cache onto both spans would count
  // the cached share twice in the trace fold.
  private liftCacheAndReasoningTokens(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const canonicalInput =
      asNumber(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]) ??
      asNumber(attrs.get(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS));
    if (canonicalInput === null) return;

    const cacheRead =
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS)) ??
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS));
    const cacheWrite = asNumber(
      attrs.take(ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS),
    );
    const noCacheTokens = asNumber(
      attrs.take(ATTR_KEYS.AI_USAGE_NO_CACHE_TOKENS),
    );

    this.liftCacheReadTokens(ctx, cacheRead);
    this.liftCacheWriteTokens(ctx, cacheWrite);
    this.rewriteFreshInputTokens({
      ctx,
      canonicalInput,
      cacheRead,
      cacheWrite,
      noCacheTokens,
    });
    this.liftReasoningTokens(ctx);
  }

  private setInputMessagesFromPrompt(
    ctx: ExtractorContext,
    prompt: unknown,
  ): void {
    if (typeof prompt === "string") {
      // Simple string prompt → wrap as user message
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
        { role: "user", content: prompt },
      ]);
      ctx.recordRule(`${this.id}:ai.prompt(string)->gen_ai.input.messages`);
      return;
    }
    if (isRecord(prompt)) {
      // Object prompt → pass through (may be a single message)
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
      ctx.recordRule(`${this.id}:ai.prompt.messages{}->gen_ai.input.messages`);
      return;
    }
    if (Array.isArray(prompt)) {
      // Array of messages → pass through directly
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
      ctx.recordRule(`${this.id}:ai.prompt.messages[]->gen_ai.input.messages`);
      return;
    }
    if (prompt !== undefined) {
      // Unknown format → best effort wrap as user message
      ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
        { role: "user", content: prompt },
      ]);
      ctx.recordRule(`${this.id}:ai.prompt(unknown)->gen_ai.input.messages`);
    }
  }

  // Vercel uses ai.prompt.messages (array) or ai.prompt (string/object)
  // Note: Custom handling required due to Vercel's flexible format
  private liftInputMessages(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    if (attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      // Output already exists, just consume to reduce leftovers
      attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES);
      attrs.take(ATTR_KEYS.AI_PROMPT);
      return;
    }

    const prompt =
      attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES) ??
      attrs.take(ATTR_KEYS.AI_PROMPT);

    this.setInputMessagesFromPrompt(ctx, prompt);

    // Annotate input messages as chat_messages if we set them
    if (ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] === undefined) return;
    recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");

    // Extract system instruction from input messages
    const inputMsgs = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES];
    if (!Array.isArray(inputMsgs)) return;
    const sysInstruction = extractSystemInstructionFromMessages(inputMsgs);
    if (sysInstruction !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, sysInstruction);
    }
  }

  private setOutputMessagesFromResponseObject(
    ctx: ExtractorContext,
    responseObj: Record<string, unknown>,
  ): void {
    const messages: unknown[] = [];

    // Extract text content
    if (typeof responseObj.text === "string" && responseObj.text.length > 0) {
      messages.push({ role: "assistant", content: responseObj.text });
    }

    // Extract object content (ai.generateObject / ai.streamObject)
    if (messages.length === 0) {
      const obj = responseObj.object;
      if (isNonEmptyString(obj)) {
        messages.push({ role: "assistant", content: obj });
      } else if (isRecord(obj) || Array.isArray(obj)) {
        messages.push({ role: "assistant", content: JSON.stringify(obj) });
      }
    }

    // Extract tool calls (Vercel-specific structure)
    if (Array.isArray(responseObj.toolCalls)) {
      messages.push({ tool_calls: responseObj.toolCalls });
    }

    if (messages.length > 0) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
      ctx.recordRule(`${this.id}:ai.response->gen_ai.output.messages`);
    }
  }

  private setOutputMessagesFromResponse({
    ctx,
    response,
    responseTextAttr,
    parsedResponseText,
  }: {
    ctx: ExtractorContext;
    response: unknown;
    responseTextAttr: unknown;
    parsedResponseText: boolean;
  }): void {
    if (parsedResponseText) {
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
        {
          role: "assistant",
          content: JSON.stringify(responseTextAttr),
        },
      ]);
      ctx.recordRule(
        `${this.id}:ai.response.text(parsed)->gen_ai.output.messages`,
      );
      return;
    }

    if (isRecord(response)) {
      this.setOutputMessagesFromResponseObject(
        ctx,
        response as Record<string, unknown>,
      );
      return;
    }

    if (isNonEmptyString(response)) {
      // Simple string response
      ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
        { role: "assistant", content: response },
      ]);
      ctx.recordRule(`${this.id}:ai.response(string)->gen_ai.output.messages`);
    }
  }

  // Fallback: flat ai.response.object attribute (generateObject / streamObject)
  private liftResponseObjectFallback(ctx: ExtractorContext): void {
    const obj = ctx.bag.attrs.take(ATTR_KEYS.AI_RESPONSE_OBJECT);
    const content = isNonEmptyString(obj)
      ? obj
      : isRecord(obj) || Array.isArray(obj)
        ? JSON.stringify(obj)
        : undefined;
    if (content === undefined) return;
    ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
      { role: "assistant", content },
    ]);
    ctx.recordRule(`${this.id}:ai.response.object->gen_ai.output.messages`);
  }

  // Vercel's ai.response may contain:
  // - { text: "...", toolCalls: [...] } object
  // - Simple string
  // Note: Custom handling required for toolCalls extraction
  private liftOutputMessages(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    if (attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)) {
      // Output already exists, just consume to reduce leftovers
      attrs.take(ATTR_KEYS.AI_RESPONSE);
      return;
    }

    const responseAttr = attrs.take(ATTR_KEYS.AI_RESPONSE);
    const hasUsableResponse =
      isNonEmptyString(responseAttr) || isRecord(responseAttr);
    const responseTextAttr = !hasUsableResponse
      ? attrs.take(ATTR_KEYS.AI_RESPONSE_TEXT)
      : undefined;
    const response = hasUsableResponse ? responseAttr : responseTextAttr;
    const parsedResponseText =
      responseTextAttr !== undefined &&
      (isRecord(responseTextAttr) || Array.isArray(responseTextAttr));

    this.setOutputMessagesFromResponse({
      ctx,
      response,
      responseTextAttr,
      parsedResponseText,
    });

    // Fallback: flat ai.response.object attribute (generateObject / streamObject)
    if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === undefined) {
      this.liftResponseObjectFallback(ctx);
    }

    // Annotate output messages as chat_messages if we set them
    if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== undefined) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
    }
  }

  apply(ctx: ExtractorContext): void {
    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // ─────────────────────────────────────────────────────────────────────────
    if (!this.isVercelSpan(ctx)) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type
    // ─────────────────────────────────────────────────────────────────────────
    this.setSpanType(ctx);

    // Tool-call spans carry the call's identity + payload under the
    // ai.toolCall.* namespace. Lift them to the canonical tool name plus
    // langwatch.input/output (and the gen_ai.tool.call.* semconv keys) so the
    // span detail reads like a real tool call, matching the synthesized claude
    // tool spans. The trace-IO fold skips span_type=tool, so these never
    // hijack the trace-level input/output.
    if (ctx.span.name === ATTR_KEYS.AI_TOOL_CALL) {
      this.liftToolCall(ctx);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Model Extraction
    // ─────────────────────────────────────────────────────────────────────────
    this.liftModel(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Usage Tokens
    // ─────────────────────────────────────────────────────────────────────────
    this.liftUsageTokens(ctx);
    this.liftCacheAndReasoningTokens(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages
    // ─────────────────────────────────────────────────────────────────────────
    this.liftInputMessages(ctx);

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages
    // ─────────────────────────────────────────────────────────────────────────
    this.liftOutputMessages(ctx);
  }

  private liftToolCall(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;
    const toolName = attrs.take(ATTR_KEYS.AI_TOOL_CALL_NAME);
    if (isNonEmptyString(toolName)) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_NAME, toolName);
      ctx.recordRule(`${this.id}:ai.toolCall.name->gen_ai.tool.name`);
    }

    const args = stringifyToolPayload(attrs.take(ATTR_KEYS.AI_TOOL_CALL_ARGS));
    if (args !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_INPUT, args);
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_CALL_ARGUMENTS, args);
      ctx.recordRule(`${this.id}:ai.toolCall.args->input`);
    }

    const result = stringifyToolPayload(
      attrs.take(ATTR_KEYS.AI_TOOL_CALL_RESULT),
    );
    if (result !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_OUTPUT, result);
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_TOOL_CALL_RESULT, result);
      ctx.recordRule(`${this.id}:ai.toolCall.result->output`);
    }
  }
}

/**
 * Tool-call args/result arrive as a JSON string or an already-parsed object.
 * Normalise to a non-empty string for langwatch.input/output.
 */
function stringifyToolPayload(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}
