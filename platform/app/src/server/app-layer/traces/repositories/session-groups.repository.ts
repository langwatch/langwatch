/**
 * Read side of the Sessions lens (specs/traces-v2/sessions-lens.feature):
 * one row per `gen_ai.conversation.id`, rolled up in ClickHouse over EVERY
 * trace of the session inside the time range, never over one fetched page.
 */

export type SessionGroupSortColumn =
  | "lastActivity"
  | "started"
  | "cost"
  | "tokens"
  | "duration"
  | "traces";

export interface SessionGroupSort {
  column: SessionGroupSortColumn;
  direction: "asc" | "desc";
}

/**
 * Keyset cursor for the session list. The sort value is the exact number the
 * repository computed for the sort column (floats are rounded in SQL so the
 * comparison is bit-stable across requests); the conversation id is the
 * unique tie-breaker that turns every supported sort into a total order.
 */
export interface SessionGroupCursor {
  sortValue: number;
  conversationId: string;
}

export interface SessionGroupsQuery {
  tenantId: string;
  timeRange: { from: number; to: number; live?: boolean };
  sort: SessionGroupSort;
  limit: number;
  cursor?: SessionGroupCursor;
  /**
   * Trace-level WHERE fragment from the filter translator. A session matches
   * when ANY of its traces matches; the rollup still sums ALL of the
   * session's traces in range.
   */
  filterWhere?: { sql: string; params: Record<string, unknown> };
  /**
   * Free-text terms that must ALL appear in the session's transcript content
   * (`log_records.BodyText` / `AttributesFlatJson`). A session matching the
   * content terms is included even when no trace summary column matches.
   */
  contentTerms?: string[];
}

export interface SessionGroupRow {
  conversationId: string;
  traceCount: number;
  totalCost: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Largest context-size attribute across the session's traces; null when never reported. */
  contextSizeTokens: number | null;
  totalDurationMs: number;
  startedAtMs: number;
  lastActivityMs: number;
  /** Distinct models across the session's traces, bounded. */
  models: string[];
  /** Most frequent model across the session's traces (approximate top-1). */
  primaryModel: string;
  /** The single service name when the session has exactly one, else empty. */
  serviceName: string;
  errorCount: number;
  warningCount: number;
  totalSpans: number;
  /**
   * The session's most recent trace, by occurrence then version. It is what
   * the row's previews were read from, and what a click on the row opens.
   * Empty only for a session the rollup found no trace for, which the group
   * itself rules out.
   */
  lastTraceId: string;
  /** Latest trace's computed previews, read separately for the page only. */
  input: string | null;
  output: string | null;
}

export interface SessionGroupsPage {
  rows: SessionGroupRow[];
  totalHits: number;
}

export interface SessionGroupsRepository {
  findSessionGroups(query: SessionGroupsQuery): Promise<SessionGroupsPage>;
}

export class NullSessionGroupsRepository implements SessionGroupsRepository {
  async findSessionGroups(): Promise<SessionGroupsPage> {
    return { rows: [], totalHits: 0 };
  }
}
