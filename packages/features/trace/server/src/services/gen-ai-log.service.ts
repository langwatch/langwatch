import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { LogExtractorContext } from "../ports/canonical-attributes.port";

const GEN_AI_RULE_PREFIX = "genai";

export function canonicaliseGenAILog(ctx: LogExtractorContext): void {
  const { attrs } = ctx.bag;

  const asNumberFrom = (key: string): number | null => {
    const raw = attrs.get(key);
    if (raw === void 0 || raw === null || raw === "") {
      return null;
    }
    let n = NaN;
    if (typeof raw === "number") {
      n = raw;
    } else if (typeof raw === "string") {
      n = Number(raw);
    }
    return Number.isFinite(n) ? n : null;
  };
  const asStringFrom = (key: string): string | null => {
    const raw = attrs.get(key);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  };
  const asJsonStringFrom = (key: string): string | null => {
    const raw = attrs.get(key);
    if (raw === void 0 || raw === null) {
      return null;
    }
    if (typeof raw === "string") {
      return raw.length > 0 ? raw : null;
    }
    if (typeof raw === "object") {
      try {
        return JSON.stringify(raw);
      } catch {
        return null;
      }
    }
    return null;
  };

  const model = asStringFrom(ATTR_KEYS.GEN_AI_REQUEST_MODEL);
  const inputTokens = asNumberFrom(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS);
  const outputTokens = asNumberFrom(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS);
  const cacheReadTokens =
    asNumberFrom("gen_ai.usage.cache_read_tokens") ??
    asNumberFrom("cached_content_token_count");
  const threadId = asStringFrom(ATTR_KEYS.GEN_AI_CONVERSATION_ID);
  const inputMessages = asJsonStringFrom(ATTR_KEYS.GEN_AI_INPUT_MESSAGES);
  const outputMessages = asJsonStringFrom(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES);

  let fired = false;
  if (model !== null) {
    ctx.setAttr("langwatch.model", model);
    fired = true;
  }
  if (inputTokens !== null) {
    ctx.setAttr("langwatch.input_tokens", String(inputTokens));
    fired = true;
  }
  if (outputTokens !== null) {
    ctx.setAttr("langwatch.output_tokens", String(outputTokens));
    fired = true;
  }
  if (cacheReadTokens !== null) {
    ctx.setAttr("langwatch.cache_read_tokens", String(cacheReadTokens));
    fired = true;
  }
  if (threadId !== null) {
    ctx.setAttr("langwatch.thread.id", threadId);
    fired = true;
  }
  if (inputMessages !== null) {
    ctx.setAttr("langwatch.input", inputMessages);
    fired = true;
  }
  if (outputMessages !== null) {
    ctx.setAttr("langwatch.output", outputMessages);
    fired = true;
  }
  if (fired) {
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:log`);
  }
}
