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
 * - langwatch.span.type (llm)
 * - gen_ai.request.model / gen_ai.response.model (from ai.model)
 * - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens (from ai.usage)
 * - gen_ai.input.messages (from ai.prompt / ai.prompt.messages)
 * - gen_ai.output.messages (from ai.response / ai.response.text)
 *
 * Special handling:
 * - ai.model is an object with { id, provider } structure
 * - ai.usage contains { promptTokens, completionTokens }
 * - ai.response may contain toolCalls array
 * - span.name is mapped to langwatch.span.type
 */

import { ATTR_KEYS } from "./_constants";
import {
  extractModelToBoth,
  extractUsageTokens,
  normaliseModelFromAiModelObject,
  recordValueType,
} from "./_extraction";
import { isRecord } from "./_guards";
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
    // Only proceed if Vercel AI SDK signals are present
    // ─────────────────────────────────────────────────────────────────────────
    if (ctx.span.instrumentationScope.name !== "ai") return;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type
    // Vercel AI SDK spans are LLM spans
    // ─────────────────────────────────────────────────────────────────────────
    const proposedSpanType = AI_SDK_SPAN_TYPE_MAP[ctx.span.name];
    if (proposedSpanType) {
      ctx.setAttr(ATTR_KEYS.SPAN_TYPE, proposedSpanType);
      ctx.recordRule(`${this.id}:span.name->langwatch.span.type`);
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
          const sysInstruction = extractSystemInstructionFromMessages(inputMsgs);
          if (sysInstruction !== null) {
            ctx.setAttrIfAbsent(
              ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION,
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

      // Annotate output messages as chat_messages if we set them
      if (ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] !== undefined) {
        recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
      }
    } else {
      // Output already exists, just consume to reduce leftovers
      attrs.take(ATTR_KEYS.AI_RESPONSE);
    }
  }
}
