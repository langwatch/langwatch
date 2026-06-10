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
 * Detection: Presence of ai.prompt, ai.prompt.messages, ai.response, ai.model,
 * or ai.usage attributes
 *
 * Canonical attributes produced:
 * - langwatch.span.type (llm / tool)
 * - gen_ai.request.model / gen_ai.response.model (from ai.model)
 * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens (from ai.usage)
 * - gen_ai.input.messages (from ai.prompt / ai.prompt.messages)
 * - gen_ai.output.messages (from ai.response / ai.response.text)
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

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
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
    const scopeMatches = ctx.span.instrumentationScope.name === "ai";
    const attrsMatch =
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_PROMPT_MESSAGES) ||
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE_TEXT) ||
      attrs.has(ATTR_KEYS.AI_USAGE) ||
      attrs.has(ATTR_KEYS.AI_TOOL_CALL_NAME);
    if (!scopeMatches && !attrsMatch) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type
    // Vercel AI SDK spans are LLM spans
    // ─────────────────────────────────────────────────────────────────────────
    const proposedSpanType = AI_SDK_SPAN_TYPE_MAP[ctx.span.name];
    if (proposedSpanType) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
      ctx.recordRule(`${this.id}:span.name->langwatch.span.type`);
    }

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
    // ai.model is an object: { id: "gpt-4", provider: "openai.chat" }
    // Normalized to "openai/gpt-4" format
    // ─────────────────────────────────────────────────────────────────────────
    if (
      !extractModelToBoth(
        ctx,
        ATTR_KEYS.AI_MODEL,
        (raw) => normaliseModelFromAiModelObject(raw),
        `${this.id}:ai.model->gen_ai.*.model`,
      )
    ) {
      // Consume attribute even if not used, to reduce leftovers
      attrs.take(ATTR_KEYS.AI_MODEL);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Usage Tokens
    // ai.usage contains { promptTokens, completionTokens }
    // ─────────────────────────────────────────────────────────────────────────
    extractUsageTokens(
      ctx,
      { object: ATTR_KEYS.AI_USAGE },
      `${this.id}:ai.usage->gen_ai.usage`,
    );

    // Cache token details. The AI SDK reports cached input as flat-dotted
    // attributes (ai.usage.inputTokenDetails.cache{Read,Write}Tokens, with
    // ai.usage.cachedInputTokens as the older read alias) rather than the
    // gen_ai.usage.cache_* convention, so map them here. Without this an
    // opencode Path B cache-creation turn (12k+ tokens) goes uncounted.
    const cacheRead =
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS)) ??
      asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS));
    const cacheWrite = asNumber(attrs.take(ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS));
    if (cacheRead !== null && cacheRead > 0) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        cacheRead,
      );
      ctx.recordRule(`${this.id}:ai.usage.cacheRead->gen_ai.usage.cache_read`);
    }
    if (cacheWrite !== null && cacheWrite > 0) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        cacheWrite,
      );
      ctx.recordRule(
        `${this.id}:ai.usage.cacheWrite->gen_ai.usage.cache_creation`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages
    // Vercel uses ai.prompt.messages (array) or ai.prompt (string/object)
    // Note: Custom handling required due to Vercel's flexible format
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const prompt =
        attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES) ??
        attrs.take(ATTR_KEYS.AI_PROMPT);

      if (typeof prompt === "string") {
        // Simple string prompt → wrap as user message
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
          { role: "user", content: prompt },
        ]);
        ctx.recordRule(`${this.id}:ai.prompt(string)->gen_ai.input.messages`);
      } else if (isRecord(prompt)) {
        // Object prompt → pass through (may be a single message)
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
        ctx.recordRule(
          `${this.id}:ai.prompt.messages{}->gen_ai.input.messages`,
        );
      } else if (Array.isArray(prompt)) {
        // Array of messages → pass through directly
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, prompt);
        ctx.recordRule(
          `${this.id}:ai.prompt.messages[]->gen_ai.input.messages`,
        );
      } else if (prompt !== undefined) {
        // Unknown format → best effort wrap as user message
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
          { role: "user", content: prompt },
        ]);
        ctx.recordRule(`${this.id}:ai.prompt(unknown)->gen_ai.input.messages`);
      }

      // Annotate input messages as chat_messages if we set them
      if (ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] !== undefined) {
        recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");

        // Extract system instruction from input messages
        const inputMsgs = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES];
        if (Array.isArray(inputMsgs)) {
          const sysInstruction =
            extractSystemInstructionFromMessages(inputMsgs);
          if (sysInstruction !== null) {
            ctx.setAttrIfAbsent(
              ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS,
              sysInstruction,
            );
          }
        }
      }
    } else {
      // Output already exists, just consume to reduce leftovers
      attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES);
      attrs.take(ATTR_KEYS.AI_PROMPT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages
    // Vercel's ai.response may contain:
    // - { text: "...", toolCalls: [...] } object
    // - Simple string
    // Note: Custom handling required for toolCalls extraction
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)) {
      const response =
        attrs.take(ATTR_KEYS.AI_RESPONSE) ??
        attrs.take(ATTR_KEYS.AI_RESPONSE_TEXT);

      if (isRecord(response)) {
        const responseObj = response as Record<string, unknown>;
        const messages: unknown[] = [];

        // Extract text content
        if (
          typeof responseObj.text === "string" &&
          responseObj.text.length > 0
        ) {
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
      } else if (typeof response === "string") {
        // Simple string response
        ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
          { role: "assistant", content: response },
        ]);
        ctx.recordRule(
          `${this.id}:ai.response(string)->gen_ai.output.messages`,
        );
      }

      // Fallback: flat ai.response.object attribute (generateObject / streamObject)
      if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === undefined) {
        const obj = attrs.take(ATTR_KEYS.AI_RESPONSE_OBJECT);
        const content = isNonEmptyString(obj)
          ? obj
          : isRecord(obj) || Array.isArray(obj)
            ? JSON.stringify(obj)
            : undefined;
        if (content !== undefined) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
            { role: "assistant", content },
          ]);
          ctx.recordRule(
            `${this.id}:ai.response.object->gen_ai.output.messages`,
          );
        }
      }

      // Annotate output messages as chat_messages if we set them
      if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== undefined) {
        recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
      }
    } else {
      // Output already exists, just consume to reduce leftovers
      attrs.take(ATTR_KEYS.AI_RESPONSE);
    }
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
