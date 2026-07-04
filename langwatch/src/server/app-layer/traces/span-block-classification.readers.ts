/**
 * OTLP span attribute readers for the block-classification service (ADR-033).
 *
 * Pure, span-in / value-out helpers extracted from the service so it keeps to
 * classification orchestration. No `this`, no state — each reads the span's
 * attribute array directly.
 */
import { coerceToNumber } from "~/utils/coerceToNumber";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { UsagePools } from "./block-classification/costAllocation.service";
import type { CodingAgentHarness } from "./block-classification/harnessDetection";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";

/** First string-valued attribute for `key`, or null. */
export function getStringAttribute(span: OtlpSpan, key: string): string | null {
  for (const attr of span.attributes) {
    if (attr.key === key && typeof attr.value.stringValue === "string") {
      return attr.value.stringValue;
    }
  }
  return null;
}

/** First numeric-ish attribute for `key` (int/double/string), or null. */
export function getNumericAttribute(span: OtlpSpan, key: string): unknown {
  for (const attr of span.attributes) {
    if (attr.key !== key) continue;
    const v = attr.value;
    return v.intValue ?? v.doubleValue ?? v.stringValue ?? null;
  }
  return null;
}

/** Flattens span attributes into a primitive-valued map for harness detection. */
export function spanAttributesRecord(span: OtlpSpan): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const attr of span.attributes) {
    if (attr.key in record) continue; // first wins
    const v = attr.value;
    record[attr.key] =
      v.stringValue ?? v.boolValue ?? v.intValue ?? v.doubleValue ?? undefined;
  }
  return record;
}

/** Parse a JSON message payload into a message array. Handles the
 * `{ type: "chat_messages", value: [...] }` wrapper, `{ messages: [...] }`, and
 * bare arrays. Returns null when it doesn't parse to a message array. */
export function messagesFromJson(jsonStr: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj.type === "chat_messages" && Array.isArray(obj.value)) {
      return obj.value;
    }
    if (Array.isArray(obj.messages)) return obj.messages;
  }
  return null;
}

/** First present message attribute (priority order) parsed into a message
 * array, or null when none is present / parseable. */
export function parseMessages(
  span: OtlpSpan,
  keys: readonly string[],
): unknown[] | null {
  for (const key of keys) {
    const raw = getStringAttribute(span, key);
    if (!raw) continue;
    const messages = messagesFromJson(raw);
    if (messages !== null) return messages;
  }
  return null;
}

/**
 * Resolve the OUTPUT message array. Output arrives EITHER as structured messages
 * (`langwatch.output` chat_messages envelope, `gen_ai.output.messages`) OR as a
 * flat assistant string — codex sets `langwatch.output` to the reply text, and
 * the Claude Code log→span converter emits the reply on `gen_ai.completion`,
 * neither of which parses as a message array. When no structured messages are
 * present, wrap the flat string as a single assistant message so the reply
 * classifies as `assistant_text` instead of dumping to the output catch-all.
 */
export function parseOutputMessages(span: OtlpSpan): unknown[] | null {
  const structured = parseMessages(span, [
    ATTR_KEYS.LANGWATCH_OUTPUT,
    ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
  ]);
  if (structured !== null) return structured;

  const text =
    getStringAttribute(span, ATTR_KEYS.LANGWATCH_OUTPUT) ??
    getStringAttribute(span, ATTR_KEYS.GEN_AI_COMPLETION);
  if (text && text.trim().length > 0) {
    return [{ role: "assistant", content: text }];
  }
  return null;
}

/** Parse a single JSON string attribute, or null when absent / unparseable. */
export function parseJsonAttribute(
  span: OtlpSpan,
  key: string,
): unknown | null {
  const raw = getStringAttribute(span, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Provider-reported usage pools (fresh / cache-read / cache-creation / output),
 * reading the first positive value across each key's aliases. */
export function extractUsagePools(
  span: OtlpSpan,
  harness: CodingAgentHarness,
): UsagePools {
  const num = (...keys: string[]): number => {
    for (const key of keys) {
      const n = coerceToNumber(getNumericAttribute(span, key));
      if (n !== null && n > 0) return n;
    }
    return 0;
  };
  const inputTokens = num(
    ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
    ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS,
  );
  const cacheReadTokens = num(
    ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
    "gen_ai.usage.cached_tokens",
  );
  return {
    // The pools are EXCLUSIVE (Anthropic convention). Codex reports
    // OpenAI-style usage where cached tokens are a SUBSET of input_tokens —
    // subtract them out of the fresh pool or input-axis allocation
    // double-counts the cached prefix (mirrors `sumStepContext`).
    inputTokens:
      harness === "codex"
        ? Math.max(0, inputTokens - cacheReadTokens)
        : inputTokens,
    outputTokens: num(
      ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS,
    ),
    cacheReadTokens,
    cacheCreationTokens: num(
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
    ),
  };
}
