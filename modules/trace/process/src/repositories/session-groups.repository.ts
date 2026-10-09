import type { Authorization } from "@langwatch/authorization";
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

interface SessionGroupSort {
  column: SessionGroupSortColumn;
  direction: "asc" | "desc";
}

/**
 * Keyset cursor for the session list. Sort value is the exact number the
 * repository computed (rounded in SQL for bit-stable comparison);
 * conversation id is the unique tie-breaker into a total order.
 */
export interface SessionGroupCursor {
  sortValue: number;
  conversationId: string;
  /**
   * The tenant of the boundary session (ADR-177 block F). On an aggregate two
   * members may share a conversation id, so the pair is the tie-breaker.
   * Absent on an older cursor, which pages on the conversation id alone.
   */
  tenantId?: string;
}

export interface SessionGroupsQuery {
  /** The proof the read is fenced by; the reader applies its tenant set. */
  authorization: Authorization;
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
  /**
   * The project the session's traces belong to. A session is a conversation
   * within one project: two members of an aggregate sharing a conversation id
   * are two sessions, not one (ADR-177 block F).
   */
  tenantId: string;
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
   * The session's most recent trace, by occurrence then version — what the
   * row's previews were read from and what a click opens. Empty only for a
   * session the rollup found no trace for, which the group itself rules out.
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

export abstract class SessionGroupsRepository {
  abstract listSessionGroups(query: SessionGroupsQuery): Promise<SessionGroupsPage>;
}

export class NullSessionGroupsRepository implements SessionGroupsRepository {
  async listSessionGroups(): Promise<SessionGroupsPage> {
    return { rows: [], totalHits: 0 };
  }
}
