import type { NormalizedAttributes } from "../../trace.spans.ts";

// Parse JSON string array; lenient [raw] fallback for unquoted labels, but
// returns [] for truncated arrays to prevent nesting loops @see ADR-066
export function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    const trimmed = raw.trim();
    const isTruncatedArray = trimmed.startsWith("[") && !trimmed.endsWith("]");
    if (isTruncatedArray) return [];
    return [raw];
  }
}

/**
 * Returns the value at `key` if it is a string, otherwise `undefined`.
 */
export function findStringAttribute(attrs: NormalizedAttributes, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Rows written before ingest folded thread ids onto `gen_ai.conversation.id` keep only a legacy
 * key. The pill, the facet and `has:conversation` read the same chain, so a shown id can match.
 */
const TRACE_CONVERSATION_ID_KEYS = [
  "gen_ai.conversation.id",
  "langgraph.thread_id",
  "langwatch.thread_id",
] as const;

/** ClickHouse expression producing the same value `deriveTraceConversationId` does. */
export const TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION = `coalesce(${TRACE_CONVERSATION_ID_KEYS.map(
  (key) => `nullIf(Attributes['${key}'], '')`,
).join(", ")}, '')`;

/** The first non-empty conversation id along the key chain, or "" when none carries one. */
export function deriveTraceConversationId(
  attributes: Record<string, string | undefined> | undefined,
): string {
  for (const key of TRACE_CONVERSATION_ID_KEYS) {
    const value = attributes?.[key];
    if (value) return value;
  }
  return "";
}
