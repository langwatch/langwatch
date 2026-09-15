import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { LogExtractorContext } from "../services/canonicalisers/canonical-attributes.service.ts";

const GEN_AI_RULE_PREFIX = "genai";

type LogAttrs = LogExtractorContext["bag"]["attrs"];

const asNumberFrom = (attrs: LogAttrs, key: string): number | null => {
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

const asStringFrom = (attrs: LogAttrs, key: string): string | null => {
  const raw = attrs.get(key);

  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

const asJsonStringFrom = (attrs: LogAttrs, key: string): string | null => {
  const raw = attrs.get(key);
  if (raw === void 0 || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw.length > 0 ? raw : null;
  }
  if (typeof raw !== "object") {
    return null;
  }

  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
};

/** Each canonical log attribute, and the source attribute it is read from. */
const LOG_ATTRIBUTES = [
  {
    target: "langwatch.model",
    read: (attrs: LogAttrs) => asStringFrom(attrs, ATTR_KEYS.GEN_AI_REQUEST_MODEL),
  },
  {
    target: "langwatch.input_tokens",
    read: (attrs: LogAttrs) => asNumberFrom(attrs, ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS),
  },
  {
    target: "langwatch.output_tokens",
    read: (attrs: LogAttrs) => asNumberFrom(attrs, ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS),
  },
  {
    target: "langwatch.cache_read_tokens",
    read: (attrs: LogAttrs) =>
      asNumberFrom(attrs, "gen_ai.usage.cache_read_tokens") ??
      asNumberFrom(attrs, "cached_content_token_count"),
  },
  {
    target: "langwatch.thread.id",
    read: (attrs: LogAttrs) => asStringFrom(attrs, ATTR_KEYS.GEN_AI_CONVERSATION_ID),
  },
  {
    target: "langwatch.input",
    read: (attrs: LogAttrs) => asJsonStringFrom(attrs, ATTR_KEYS.GEN_AI_INPUT_MESSAGES),
  },
  {
    target: "langwatch.output",
    read: (attrs: LogAttrs) => asJsonStringFrom(attrs, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES),
  },
] as const;

export function canonicaliseGenAILog(ctx: LogExtractorContext): void {
  const { attrs } = ctx.bag;

  let fired = false;
  for (const { target, read } of LOG_ATTRIBUTES) {
    const value = read(attrs);
    if (value === null) continue;

    ctx.setAttr(target, String(value));
    fired = true;
  }

  if (fired) {
    ctx.recordRule(`${GEN_AI_RULE_PREFIX}:log`);
  }
}
