import { ValidationError } from "@langwatch/handled-error";
import { z } from "zod";
import type {
  SessionGroupCursor,
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsRepository,
} from "./repositories/session-groups.repository";
import { teaserOf } from "./visibility-window.service";

/**
 * The Sessions lens read (specs/traces-v2/sessions-lens.feature): true
 * per-session rollups over `trace_summaries`, enriched with the pre-folded
 * coding-agent session counters when the conversation id matches a
 * coding-agent session (session id == `gen_ai.conversation.id`).
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

/** How many coding-agent session lookups run concurrently per page. */
const ENRICHMENT_CONCURRENCY = 10;

export interface SessionGroupCodingAgentDto {
  modelCalls: number;
  compactions: number;
  peakContextTokens: number;
  subAgents: number;
}

export interface SessionGroupDto {
  conversationId: string;
  traceCount: number;
  totalCost: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextSizeTokens: number | null;
  totalDurationMs: number;
  startedAtMs: number;
  lastActivityMs: number;
  models: string[];
  primaryModel: string;
  serviceName: string;
  errorCount: number;
  warningCount: number;
  totalSpans: number;
  /** Latest trace's computed input/output previews for the row label. */
  input: string | null;
  output: string | null;
  /**
   * Pre-folded coding-agent counters when a `coding_agent_sessions` row
   * exists for this conversation id; null for ordinary conversations.
   */
  codingAgent: SessionGroupCodingAgentDto | null;
}

export interface SessionGroupsResult {
  sessions: SessionGroupDto[];
  totalHits: number;
  nextCursor: string | null;
}

interface SessionGroupsParams {
  tenantId: string;
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

/**
 * The narrow slice of {@link CodingAgentSessionService} this read needs.
 * Structural on purpose: the full session row satisfies it, and tests can
 * hand in a plain object.
 */
export interface CodingAgentSessionLookup {
  getBySessionId(args: {
    projectId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<SessionGroupCodingAgentDto | null>;
}

/**
 * Every sort dimension a cursor may name, keyed by the union so the compiler
 * refuses a list that has drifted in EITHER direction. A new
 * `SessionGroupSortColumn` missing from here would make the cursor schema
 * reject a cursor this very service minted, and the caller would lose the
 * page mid-walk.
 */
const SORT_COLUMN_KEYS: Record<SessionGroupSortColumn, true> = {
  lastActivity: true,
  started: true,
  cost: true,
  tokens: true,
  duration: true,
  traces: true,
};

const SORT_COLUMNS = Object.keys(SORT_COLUMN_KEYS) as [
  SessionGroupSortColumn,
  ...SessionGroupSortColumn[],
];

/**
 * The decoded cursor. It carries the sort it was minted under because
 * `sortValue` is meaningless without it: the repository recomputes the keyset
 * boundary from the CURRENT sort, so a cursor from a cost sort compared
 * against a timestamp aggregate would silently page through nonsense.
 */
const sessionGroupsCursorSchema = z.object({
  sortValue: z.number().finite(),
  conversationId: z.string().min(1),
  sortColumn: z.enum(SORT_COLUMNS),
  sortDirection: z.enum(["asc", "desc"]),
});

export type SessionGroupsCursor = z.infer<typeof sessionGroupsCursorSchema>;

/**
 * Opaque session page cursor. Base64url-encoded JSON so the wire shape can
 * evolve without clients ever parsing it. Client-supplied on the way back in,
 * so the decode validates rather than asserts.
 */
export function encodeSessionGroupsCursor(cursor: SessionGroupsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSessionGroupsCursor(
  encoded: string,
): SessionGroupsCursor {
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

/**
 * The repository's keyset boundary for this request. A cursor minted under
 * another sort points at a boundary the repository would compare against a
 * different aggregate expression, so a dollar amount would be measured
 * against a timestamp and the caller would walk an arbitrary window with no
 * error. Refuse it instead.
 */
function keysetCursorFor({
  encoded,
  sortColumn,
  sortDirection,
}: {
  encoded: string | undefined;
  sortColumn: SessionGroupSortColumn;
  sortDirection: "asc" | "desc";
}): SessionGroupCursor | undefined {
  if (encoded === undefined) return undefined;
  const cursor = decodeSessionGroupsCursor(encoded);
  if (
    cursor.sortColumn !== sortColumn ||
    cursor.sortDirection !== sortDirection
  ) {
    throw new ValidationError("Sessions cursor does not match the sort");
  }
  return {
    sortValue: cursor.sortValue,
    conversationId: cursor.conversationId,
  };
}

/** Keep in lockstep with SORT_EXPRESSIONS in the ClickHouse repository. */
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

export function mapSessionGroupRowToDto({
  row,
  codingAgent,
}: {
  row: SessionGroupRow;
  codingAgent: SessionGroupCodingAgentDto | null;
}): SessionGroupDto {
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
    input: row.input,
    output: row.output,
    codingAgent,
  };
}

export class SessionGroupsService {
  constructor(
    private readonly repository: SessionGroupsRepository,
    private readonly codingAgentSessions: CodingAgentSessionLookup,
  ) {}

  async getSessionGroups(
    params: SessionGroupsParams,
  ): Promise<SessionGroupsResult> {
    const sortColumn =
      SORT_COLUMN_MAP[params.sort?.columnId ?? ""] ?? DEFAULT_SORT.column;
    const sortDirection = params.sort?.direction ?? DEFAULT_SORT.direction;
    const page = await this.repository.findSessionGroups({
      tenantId: params.tenantId,
      timeRange: params.timeRange,
      sort: { column: sortColumn, direction: sortDirection },
      // One sentinel row past the page so `nextCursor` is exact.
      limit: params.pageSize + 1,
      cursor: keysetCursorFor({
        encoded: params.cursor,
        sortColumn,
        sortDirection,
      }),
      filterWhere: params.filterWhere,
      contentTerms: params.contentTerms,
    });

    const hasMore = page.rows.length > params.pageSize;
    const visibleRows = hasMore
      ? page.rows.slice(0, params.pageSize)
      : page.rows;

    const enrichments = await this.enrich({
      tenantId: params.tenantId,
      rows: visibleRows,
    });

    const sessions = visibleRows.map((row, index) => {
      const dto = mapSessionGroupRowToDto({
        row,
        codingAgent: enrichments[index] ?? null,
      });
      // Tease previews of sessions beyond the caller's visibility window,
      // rollup numbers stay untouched, mirroring the trace list's gate.
      if (
        params.visibilityCutoffMs !== null &&
        params.visibilityCutoffMs !== undefined &&
        row.lastActivityMs < params.visibilityCutoffMs
      ) {
        return {
          ...dto,
          input: dto.input ? teaserOf(dto.input) : dto.input,
          output: dto.output ? teaserOf(dto.output) : dto.output,
        };
      }
      return dto;
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
              sortColumn,
              sortDirection,
            })
          : null,
    };
  }

  /**
   * Coding-agent counters per session, bounded fan-out. Best-effort by
   * design: a missing session row is the normal answer for ordinary
   * conversations, and a failed lookup must not take the whole list down.
   */
  private async enrich({
    tenantId,
    rows,
  }: {
    tenantId: string;
    rows: SessionGroupRow[];
  }): Promise<(SessionGroupCodingAgentDto | null)[]> {
    const results: (SessionGroupCodingAgentDto | null)[] = [];
    for (let i = 0; i < rows.length; i += ENRICHMENT_CONCURRENCY) {
      const chunk = rows.slice(i, i + ENRICHMENT_CONCURRENCY);
      const settled = await Promise.all(
        chunk.map((row) =>
          this.codingAgentSessions
            .getBySessionId({
              projectId: tenantId,
              sessionId: row.conversationId,
              startedAtMs: row.startedAtMs,
            })
            .then((session) =>
              session
                ? {
                    modelCalls: session.modelCalls,
                    compactions: session.compactions,
                    peakContextTokens: session.peakContextTokens,
                    subAgents: session.subAgents,
                  }
                : null,
            )
            .catch(() => null),
        ),
      );
      results.push(...settled);
    }
    return results;
  }
}
