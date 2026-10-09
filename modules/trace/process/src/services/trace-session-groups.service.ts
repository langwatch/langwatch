import type { Authorization } from "@langwatch/authorization";
import { ValidationError } from "@langwatch/handled-error";
import type { SessionGroupDto, SessionGroupsResult } from "@langwatch/trace-contract";
import { teaserOf } from "@langwatch/trace-contract";
import { z } from "zod";

import type {
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsRepository,
  SessionGroupCursor,
} from "../repositories/session-groups.repository.ts";

const SORT_COLUMN_KEYS = {
  lastActivity: true,
  started: true,
  cost: true,
  tokens: true,
  duration: true,
  traces: true,
} as const satisfies Record<SessionGroupSortColumn, true>;

const SORT_COLUMNS = Object.keys(SORT_COLUMN_KEYS) as [
  SessionGroupSortColumn,
  ...SessionGroupSortColumn[],
];

const sessionGroupsCursorSchema = z.object({
  sortValue: z.number().finite(),
  conversationId: z.string().min(1),
  /** The boundary session's tenant; absent on a cursor minted before it was carried. */
  tenantId: z.string().min(1).optional(),
  sortColumn: z.enum(SORT_COLUMNS),
  sortDirection: z.enum(["asc", "desc"]),
});

type SessionGroupsCursor = z.infer<typeof sessionGroupsCursorSchema>;

function encodeSessionGroupsCursor(cursor: SessionGroupsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSessionGroupsCursor(encoded: string): SessionGroupsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid sessions cursor");
  }

  const result = sessionGroupsCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError("Invalid sessions cursor");
  }

  return result.data;
}

function buildKeysetCursor({
  encoded,
  sortColumn,
  sortDirection,
}: {
  encoded: string | undefined;
  sortColumn: SessionGroupSortColumn;
  sortDirection: "asc" | "desc";
}): SessionGroupCursor | undefined {
  if (encoded === undefined) {
    return undefined;
  }

  const cursor = decodeSessionGroupsCursor(encoded);
  if (cursor.sortColumn !== sortColumn || cursor.sortDirection !== sortDirection) {
    throw new ValidationError("Sessions cursor does not match the sort");
  }

  return {
    sortValue: cursor.sortValue,
    conversationId: cursor.conversationId,
    ...(cursor.tenantId === void 0 ? {} : { tenantId: cursor.tenantId }),
  };
}

function cursorSortValueForRow({
  row,
  column,
}: {
  row: SessionGroupRow;
  column: SessionGroupSortColumn;
}): number {
  switch (column) {
    case "lastActivity":
      return row.lastActivityMs;
    case "started":
      return row.startedAtMs;
    case "cost":
      return row.totalCost;
    case "tokens":
      return row.totalTokens;
    case "duration":
      return row.totalDurationMs;
    case "traces":
      return row.traceCount;
  }
}

/**
 * The Sessions lens read (specs/traces-v2/sessions-lens.feature): true per-session rollups over
 * `trace_summaries`, enriched with pre-folded coding-agent session counters when the conversation
 * id matches a coding-agent session (session id equals `gen_ai.conversation.id`).
 */

/** Lens sort column ids (frontend vocabulary) → repository sort dimensions. */
const SORT_COLUMN_MAP: Record<string, SessionGroupSortColumn> = {
  lastTurn: "lastActivity",
  started: "started",
  cost: "cost",
  tokens: "tokens",
  duration: "duration",
  turns: "traces",
};

const DEFAULT_SORT: { column: SessionGroupSortColumn; direction: "desc" } = {
  column: "lastActivity",
  direction: "desc",
};

/** A session row stores "nothing reported this" as an empty string. */
const normalizeEmptyToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : value;

/**
 * One session past the caller's visibility window: conversation content is teased, rollup numbers
 * are untouched, mirroring the trace list's gate. Coding-agent teases the title it adds alike.
 */
function teasedSession(session: SessionGroupDto): SessionGroupDto {
  return {
    ...session,
    input: session.input ? teaserOf(session.input) : session.input,
    output: session.output ? teaserOf(session.output) : session.output,
  };
}

interface SessionGroupsParams {
  /** The route's proof; the rollup reads through it (ADR-175). */
  authorization: Authorization;
  timeRange: { from: number; to: number; live?: boolean };
  sort?: { columnId: string; direction: "asc" | "desc" };
  pageSize: number;
  cursor?: string;
  filterWhere?: { sql: string; params: Record<string, unknown> };
  contentTerms?: string[];
  /**
   * Visibility gate: sessions whose last activity is older than this cutoff
   * get their input/output previews teaser-redacted, like the trace list.
   */
  visibilityCutoffMs?: number | null;
}

export class SessionGroupsService {
  static create(options: { repository: SessionGroupsRepository }): SessionGroupsService {
    return new SessionGroupsService(options.repository);
  }

  static encodeSessionGroupsCursor(cursor: SessionGroupsCursor): string {
    return encodeSessionGroupsCursor(cursor);
  }

  static decodeSessionGroupsCursor(encoded: string): SessionGroupsCursor {
    return decodeSessionGroupsCursor(encoded);
  }

  private constructor(private readonly repository: SessionGroupsRepository) {}

  async getSessionGroups(params: SessionGroupsParams): Promise<SessionGroupsResult> {
    const sortColumn = SORT_COLUMN_MAP[params.sort?.columnId ?? ""] ?? DEFAULT_SORT.column;
    const sortDirection = params.sort?.direction ?? DEFAULT_SORT.direction;
    const page = await this.repository.listSessionGroups({
      authorization: params.authorization,
      timeRange: params.timeRange,
      sort: { column: sortColumn, direction: sortDirection },
      // One sentinel row past the page so `nextCursor` is exact.
      limit: params.pageSize + 1,
      cursor: buildKeysetCursor({
        encoded: params.cursor,
        sortColumn,
        sortDirection,
      }),
      filterWhere: params.filterWhere,
      contentTerms: params.contentTerms,
    });

    const hasMore = page.rows.length > params.pageSize;
    const visibleRows = hasMore ? page.rows.slice(0, params.pageSize) : page.rows;

    const cutoffMs = params.visibilityCutoffMs ?? null;
    const sessions = visibleRows.map((row) => {
      const dto = SessionGroupsService.mapSessionGroupRowToDto({ row });

      return cutoffMs !== null && row.lastActivityMs < cutoffMs ? teasedSession(dto) : dto;
    });

    const lastRow = visibleRows[visibleRows.length - 1];

    return {
      sessions,
      totalHits: page.totalHits,
      nextCursor:
        hasMore && lastRow
          ? encodeSessionGroupsCursor({
              sortValue: cursorSortValueForRow({
                row: lastRow,
                column: sortColumn,
              }),
              conversationId: lastRow.conversationId,
              tenantId: lastRow.tenantId,
              sortColumn,
              sortDirection,
            })
          : null,
    };
  }

  /** A rollup row as the lens reads it; coding-agent, serving the lens, fills `codingAgent`. */
  static mapSessionGroupRowToDto({ row }: { row: SessionGroupRow }): SessionGroupDto {
    return {
      conversationId: row.conversationId,
      traceCount: row.traceCount,
      totalCost: row.totalCost,
      totalTokens: row.totalTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      contextSizeTokens: row.contextSizeTokens,
      totalDurationMs: row.totalDurationMs,
      startedAtMs: row.startedAtMs,
      lastActivityMs: row.lastActivityMs,
      models: row.models,
      primaryModel: row.primaryModel,
      serviceName: row.serviceName,
      errorCount: row.errorCount,
      warningCount: row.warningCount,
      totalSpans: row.totalSpans,
      lastTraceId: normalizeEmptyToNull(row.lastTraceId),
      input: row.input,
      output: row.output,
      codingAgent: null,
    };
  }
}
