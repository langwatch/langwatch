/**
 * One resolved source for a trace's conversation id.
 *
 * A summary row can carry its conversation id under more than one
 * attribute key: the canonical `gen_ai.conversation.id`, plus the legacy
 * keys the canonicaliser folds into it at ingest (`langgraph.thread_id`,
 * `langwatch.thread_id`). Rows written before that fold existed keep the
 * legacy key only. Every surface that reads or filters by conversation —
 * the drawer header pill, the facet expression, the has/none predicate,
 * the trace-header mapper — resolves through this module so display and
 * query can never disagree.
 */

/** Precedence: canonical first, then the legacy keys in fold order. */
const CONVERSATION_ID_KEYS = [
  "gen_ai.conversation.id",
  "langgraph.thread_id",
  "langwatch.thread_id",
] as const;

/**
 * ClickHouse expression resolving to the conversation id for the row, or ''
 * when no supported key carries one. Map lookups yield '' for missing keys,
 * so each candidate is wrapped in nullIf to let coalesce fall through.
 */
export const CONVERSATION_ID_CLICKHOUSE_EXPRESSION = `coalesce(${CONVERSATION_ID_KEYS.map(
  (key) => `nullIf(Attributes['${key}'], '')`,
).join(", ")}, '')`;

/**
 * In-memory mirror of {@link CONVERSATION_ID_CLICKHOUSE_EXPRESSION}: the
 * first non-empty value across the same keys in the same order, else ''.
 */
export function resolveConversationId(
  attributes: Record<string, string | undefined>,
): string {
  for (const key of CONVERSATION_ID_KEYS) {
    const value = attributes[key];
    if (value) return value;
  }
  return "";
}
