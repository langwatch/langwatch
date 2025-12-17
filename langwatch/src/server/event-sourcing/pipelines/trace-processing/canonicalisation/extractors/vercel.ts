import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import {
  safeJsonParse,
  isRecord,
  normaliseModelFromAiModelObject,
  extractUsageTokens,
  inferSpanTypeIfAbsent,
  extractModelToBoth,
} from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from Vercel AI SDK spans.
 *
 * Handles:
 * - `ai.prompt` / `ai.prompt.messages` → `gen_ai.input.messages`
 * - `ai.response` → `gen_ai.output.messages`
 * - `ai.model` → `gen_ai.request.model` / `gen_ai.response.model`
 * - `ai.usage` → `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`
 * - Infers `langwatch.span.type` as "llm" if Vercel signals are present
 *
 * @example
 * ```typescript
 * const extractor = new VercelExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class VercelExtractor implements CanonicalAttributesExtractor {
  readonly id = "vercel";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const hasSignal =
      attrs.has(ATTR_KEYS.AI_PROMPT) ||
      attrs.has(ATTR_KEYS.AI_PROMPT_MESSAGES) ||
      attrs.has(ATTR_KEYS.AI_RESPONSE) ||
      attrs.has(ATTR_KEYS.AI_MODEL) ||
      attrs.has(ATTR_KEYS.AI_USAGE);

    if (!hasSignal) return;

    // type (don't override explicit)
    inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);

    // model
    if (
      !extractModelToBoth(
        ctx,
        ATTR_KEYS.AI_MODEL,
        (raw) => normaliseModelFromAiModelObject(safeJsonParse(raw)),
        `${this.id}:ai.model->gen_ai.*.model`
      )
    ) {
      // Consume even if not used to reduce leftovers
      attrs.take(ATTR_KEYS.AI_MODEL);
    }

    // usage
    extractUsageTokens(
      ctx,
      { object: ATTR_KEYS.AI_USAGE },
      `${this.id}:ai.usage->gen_ai.usage`
    );

    // input - handle Vercel's special format
    if (!attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const promptRaw =
        attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES) ?? attrs.take(ATTR_KEYS.AI_PROMPT);
      const prompt = safeJsonParse(promptRaw);

      if (typeof prompt === "string") {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
          { role: "user", content: prompt },
        ]);
        ctx.recordRule(`${this.id}:ai.prompt(string)->gen_ai.input.messages`);
      } else if (isRecord(prompt) && Array.isArray((prompt as Record<string, unknown>).messages)) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, (prompt as Record<string, unknown>).messages);
        ctx.recordRule(`${this.id}:ai.prompt.messages->gen_ai.input.messages`);
      } else if (promptRaw !== undefined) {
        // best effort
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, [
          { role: "user", content: prompt },
        ]);
        ctx.recordRule(`${this.id}:ai.prompt(unknown)->gen_ai.input.messages`);
      }
    } else {
      attrs.take(ATTR_KEYS.AI_PROMPT_MESSAGES);
      attrs.take(ATTR_KEYS.AI_PROMPT);
    }

    // output - handle Vercel's special format with toolCalls
    if (!attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)) {
      const resp = safeJsonParse(attrs.take(ATTR_KEYS.AI_RESPONSE));

      if (isRecord(resp)) {
        const msgs: unknown[] = [];
        const respObj = resp as Record<string, unknown>;

        if (
          typeof respObj.text === "string" &&
          respObj.text.length > 0
        ) {
          msgs.push({ role: "assistant", content: respObj.text });
        }
        if (Array.isArray(respObj.toolCalls)) {
          msgs.push({ tool_calls: respObj.toolCalls });
        }

        if (msgs.length > 0) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, msgs);
          ctx.recordRule(`${this.id}:ai.response->gen_ai.output.messages`);
        }
      } else if (typeof resp === "string") {
        ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [
          { role: "assistant", content: resp },
        ]);
        ctx.recordRule(
          `${this.id}:ai.response(string)->gen_ai.output.messages`
        );
      }
    } else {
      attrs.take(ATTR_KEYS.AI_RESPONSE);
    }
  }
}
