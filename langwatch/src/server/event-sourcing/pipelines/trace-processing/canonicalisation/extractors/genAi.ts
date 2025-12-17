import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import {
  safeJsonParse,
  isRecord,
  asNumber,
  coerceToStringArray,
  extractSystemInstructionFromMessages,
  spanTypeToGenAiOperationName,
  decodeMessagesPayload,
  extractInputMessages,
  extractOutputMessages,
  extractModelToBoth,
  extractUsageTokens,
} from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from GenAI/OpenTelemetry LLM spans.
 * 
 * Handles:
 * - `langwatch.span.type` / `type` → `gen_ai.operation.name` (derived)
 * - `llm.model_name` → `gen_ai.request.model` / `gen_ai.response.model`
 * - `gen_ai.prompt` / `llm.input_messages` → `gen_ai.input.messages` (with system instruction extraction)
 * - `gen_ai.completion` / `llm.output_messages` → `gen_ai.output.messages`
 * - `gen_ai.usage.*` / `gen_ai.usage.prompt_tokens` / `gen_ai.usage.completion_tokens` → usage tokens
 * - `llm.invocation_parameters` → various `gen_ai.request.*` parameters
 * 
 * This is the main extractor for OpenTelemetry GenAI semantic conventions and legacy LLM attributes.
 * 
 * @example
 * ```typescript
 * const extractor = new GenAIExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class GenAIExtractor implements CanonicalAttributesExtractor {
  readonly id = "genai";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // operation.name (derived)
    if (!attrs.has(ATTR_KEYS.GEN_AI_OPERATION_NAME)) {
      const t = attrs.get(ATTR_KEYS.SPAN_TYPE) ?? attrs.get(ATTR_KEYS.TYPE);
      const op = spanTypeToGenAiOperationName(t);
      if (op) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_OPERATION_NAME, op);
        ctx.recordRule(`${this.id}:operation.name`);
      }
    }

    // model: prefer existing gen_ai.*.model, else llm.model_name
    extractModelToBoth(
      ctx,
      ATTR_KEYS.LLM_MODEL_NAME,
      (raw) => (typeof raw === "string" ? raw : null),
      `${this.id}:model(llm.model_name)`
    );

    // input messages: prefer direct, else legacy prompt / llm.input_messages
    if (!attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const promptRaw =
        attrs.take(ATTR_KEYS.GEN_AI_PROMPT) ?? attrs.take(ATTR_KEYS.LLM_INPUT_MESSAGES);

      if (promptRaw !== void 0) {
        const parsed = safeJsonParse(promptRaw);
        const decoded = decodeMessagesPayload(parsed);

        let msgs: unknown = null;
        if (Array.isArray(decoded)) msgs = decoded;
        else if (isRecord(decoded) && Array.isArray((decoded as Record<string, unknown>).messages))
          msgs = (decoded as Record<string, unknown>).messages;
        else if (typeof decoded === "string")
          msgs = [{ role: "user", content: decoded }];

        if (msgs) {
          const { systemInstruction, remainingMessages } =
            extractSystemInstructionFromMessages(msgs);

          ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, remainingMessages);
          if (systemInstruction !== null)
            ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_SYSTEM_INSTRUCTION, systemInstruction);

          ctx.recordRule(`${this.id}:input.messages`);
        }
      }
    }

    // output messages: prefer direct, else legacy completion / llm.output_messages
    extractOutputMessages(
      ctx,
      [
        { type: "attr", keys: [ATTR_KEYS.GEN_AI_COMPLETION, ATTR_KEYS.LLM_OUTPUT_MESSAGES] },
      ],
      `${this.id}:output.messages`
    );

    // usage (support both modern + legacy prompt/completion tokens)
    extractUsageTokens(
      ctx,
      {
        input: [ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS],
        output: [ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS],
      },
      `${this.id}:usage`
    );

    // request params from llm.invocation_parameters
    const inv = safeJsonParse(attrs.take(ATTR_KEYS.LLM_INVOCATION_PARAMETERS));
    if (isRecord(inv)) {
      const p = inv as Record<string, unknown>;

      const temperature = asNumber(p.temperature);
      const maxTokens = asNumber(p.max_tokens);
      const topP = asNumber(p.top_p);
      const freq = asNumber(p.frequency_penalty);
      const pres = asNumber(p.presence_penalty);
      const seed = asNumber(p.seed);
      const n = asNumber(p.n);

      if (temperature !== null)
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_TEMPERATURE, temperature);
      if (maxTokens !== null)
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
      if (topP !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_TOP_P, topP);
      if (freq !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_FREQUENCY_PENALTY, freq);
      if (pres !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_PRESENCE_PENALTY, pres);
      if (seed !== null) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_SEED, seed);

      const stop = coerceToStringArray(p.stop);
      if (stop) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_STOP_SEQUENCES, stop);

      if (n !== null && n !== 1) ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_CHOICE_COUNT, n);

      ctx.recordRule(`${this.id}:params`);
    }
  }
}
