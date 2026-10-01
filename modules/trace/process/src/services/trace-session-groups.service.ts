import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { ValidationError } from "@langwatch/handled-error";
import type {
  SessionGroupCodingAgentDto,
  SessionGroupDto,
  SessionGroupsResult,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type {
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsRepository,
  SessionGroupCursor,
} from "../repositories/session-groups.repository.ts";
import { VisibilityWindowService } from "./trace-visibility-window.service.ts";

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
  sortColumn: z.enum(SORT_COLUMNS),
  sortDirection: z.enum(["asc", "desc"]),
});

export type SessionGroupsCursor = z.infer<typeof sessionGroupsCursorSchema>;

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

/** How many coding-agent session lookups run concurrently per page. */
const ENRICHMENT_CONCURRENCY = 10;

/** A session row stores "nothing reported this" as an empty string. */
const normalizeEmptyToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : value;

/**
 * One session past the caller's visibility window: conversation content is teased, rollup numbers
 * are untouched, mirroring the trace list's gate. The generated title is written from the
 * conversation so it is teased too; the git identity is operational metadata and stays whole.
 */
function teasedSession(session: SessionGroupDto): SessionGroupDto {
  return {
    ...session,
    input: session.input ? VisibilityWindowService.teaserOf(session.input) : session.input,
    output: session.output ? VisibilityWindowService.teaserOf(session.output) : session.output,
    codingAgent: session.codingAgent
      ? {
          ...session.codingAgent,
          title: session.codingAgent.title
            ? VisibilityWindowService.teaserOf(session.codingAgent.title)
            : session.codingAgent.title,
        }
      : session.codingAgent,
  };
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

export class SessionGroupsService {
  static create(options: {
    repository: SessionGroupsRepository;
    codingAgentSessions: CodingAgentApi;
    resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
  }): SessionGroupsService {
    return new SessionGroupsService(options);
  }

  static encodeSessionGroupsCursor(cursor: SessionGroupsCursor): string {
    return encodeSessionGroupsCursor(cursor);
  }

  static decodeSessionGroupsCursor(encoded: string): SessionGroupsCursor {
    return decodeSessionGroupsCursor(encoded);
  }

  private readonly repository: SessionGroupsRepository;
  private readonly codingAgentSessions: CodingAgentApi;
  /**
   * The lens is project-scoped but pull requests are org-scoped, so the join
   * needs the owning organization. Returns undefined for an orphan project,
   * which simply leaves every row unlinked.
   */
  private readonly resolveOrganizationId: (projectId: string) => Promise<string | undefined>;

  private constructor({
    repository,
    codingAgentSessions,
    resolveOrganizationId = async () => undefined,
  }: {
    repository: SessionGroupsRepository;
    codingAgentSessions: CodingAgentApi;
    resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
  }) {
    this.repository = repository;
    this.codingAgentSessions = codingAgentSessions;
    this.resolveOrganizationId = resolveOrganizationId;
  }

  async getSessionGroups(params: SessionGroupsParams): Promise<SessionGroupsResult> {
    const sortColumn = SORT_COLUMN_MAP[params.sort?.columnId ?? ""] ?? DEFAULT_SORT.column;
    const sortDirection = params.sort?.direction ?? DEFAULT_SORT.direction;
    const page = await this.repository.listSessionGroups({
      tenantId: params.tenantId,
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

    const enrichments = await this.enrich({
      tenantId: params.tenantId,
      rows: visibleRows,
    });
    await this.linkPullRequests({
      tenantId: params.tenantId,
      rows: visibleRows,
      enrichments,
    });

    const cutoffMs = params.visibilityCutoffMs ?? null;
    const sessions = visibleRows.map((row, index) => {
      const dto = SessionGroupsService.mapSessionGroupRowToDto({
        row,
        codingAgent: enrichments[index] ?? null,
      });

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
            .findBySessionId({
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
                    // The row stores "unset" as an empty string; the lens
                    // renders absence, so it reads back as null here.
                    repositoryHost: normalizeEmptyToNull(session.repositoryHost),
                    repositoryOwner: normalizeEmptyToNull(session.repositoryOwner),
                    repositoryName: normalizeEmptyToNull(session.repositoryName),
                    gitBranch: normalizeEmptyToNull(session.gitBranch),
                    gitWorktree: normalizeEmptyToNull(session.gitWorktree),
                    title: normalizeEmptyToNull(session.title),
                    // Filled in by linkPullRequests, in one batched lookup for
                    // the whole page rather than one per row.
                    pullRequest: null,
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

  /**
   * Attach each session to the pull request its branch's history says it belongs to, for the whole
   * page in one lookup. Best-effort like the enrichment it decorates: no GitHub connection, an
   * unreachable repository or a failed read all leave rows unlinked rather than failing the list.
   */
  private async linkPullRequests({
    tenantId,
    rows,
    enrichments,
  }: {
    tenantId: string;
    rows: SessionGroupRow[];
    enrichments: (SessionGroupCodingAgentDto | null)[];
  }): Promise<void> {
    try {
      const organizationId = await this.resolveOrganizationId(tenantId);
      if (!organizationId) {
        return;
      }

      const links = await this.codingAgentSessions.linkTraceSessionsToPullRequests({
        organizationId,
        sessions: rows.map((row, index) => {
          const codingAgent = enrichments[index];

          return {
            sessionId: row.conversationId,
            startedAtMs: row.startedAtMs,
            repositoryHost: codingAgent?.repositoryHost ?? null,
            repositoryOwner: codingAgent?.repositoryOwner ?? null,
            repositoryName: codingAgent?.repositoryName ?? null,
            gitBranch: codingAgent?.gitBranch ?? null,
          };
        }),
      });

      const pullRequestBySessionId = new Map(
        links.map((link) => [link.sessionId, link.pullRequest]),
      );

      rows.forEach((row, index) => {
        const pullRequest = pullRequestBySessionId.get(row.conversationId);
        const codingAgent = enrichments[index];
        if (pullRequest && codingAgent) {
          codingAgent.pullRequest = pullRequest;
        }
      });
    } catch {
      // Unlinked is a correct answer; a failed join must not take the list down.
      return;
    }
  }

  static mapSessionGroupRowToDto({
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
      lastTraceId: normalizeEmptyToNull(row.lastTraceId),
      input: row.input,
      output: row.output,
      codingAgent,
    };
  }
}
