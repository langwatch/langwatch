import type {
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsRepository,
} from "./repositories/session-groups.repository";
import {
  cursorSortValueForRow,
  encodeSessionGroupsCursor,
  keysetCursorFor,
} from "./session-groups.cursor";
import {
  branchKeysOf,
  type GithubPullRequestLookup,
  linkableSessions,
  linkPullRequestsToSessions,
  NullGithubPullRequestLookup,
  type SessionGroupPullRequestDto,
} from "./session-groups.pull-request-link";
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

/** A session row stores "nothing reported this" as an empty string. */
const emptyToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : value;

/**
 * One session past the caller's visibility window: the conversation content it
 * carries is teased, its rollup numbers are untouched, mirroring the trace
 * list's gate. The generated title is written FROM the conversation, so it is
 * teased with the previews; the git identity is operational metadata about
 * where the session ran and stays whole.
 */
function teasedSession(session: SessionGroupDto): SessionGroupDto {
  return {
    ...session,
    input: session.input ? teaserOf(session.input) : session.input,
    output: session.output ? teaserOf(session.output) : session.output,
    codingAgent: session.codingAgent
      ? {
          ...session.codingAgent,
          title: session.codingAgent.title
            ? teaserOf(session.codingAgent.title)
            : session.codingAgent.title,
        }
      : session.codingAgent,
  };
}

export interface SessionGroupCodingAgentDto {
  modelCalls: number;
  compactions: number;
  peakContextTokens: number;
  subAgents: number;
  /**
   * Where the session ran, from the LangWatch companion event, and the title
   * the agent generated for it. Null for every session whose agent has no
   * companion emitter, which is most of them.
   */
  repositoryHost: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  gitBranch: string | null;
  gitWorktree: string | null;
  title: string | null;
  /**
   * The pull request this session's work belongs to, decided by the tenure
   * rule over the branch's mapped pull requests. Null for a session with no
   * git context, a repository the organization's GitHub connection does not
   * reach, or a branch whose pull request has not been opened yet.
   */
  pullRequest: SessionGroupPullRequestDto | null;
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
  /**
   * The session's most recent trace, the one a click on the row opens. Null
   * when the rollup named none.
   */
  lastTraceId: string | null;
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
  tryGetBySessionId(args: {
    projectId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<Omit<SessionGroupCodingAgentDto, "pullRequest"> | null>;
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
    lastTraceId: emptyToNull(row.lastTraceId),
    input: row.input,
    output: row.output,
    codingAgent,
  };
}

export class SessionGroupsService {
  private readonly repository: SessionGroupsRepository;
  private readonly codingAgentSessions: CodingAgentSessionLookup;
  private readonly pullRequests: GithubPullRequestLookup;
  /**
   * The lens is project-scoped but pull requests are org-scoped, so the join
   * needs the owning organization. Returns undefined for an orphan project,
   * which simply leaves every row unlinked.
   */
  private readonly resolveOrganizationId: (
    projectId: string,
  ) => Promise<string | undefined>;

  constructor({
    repository,
    codingAgentSessions,
    pullRequests = new NullGithubPullRequestLookup(),
    resolveOrganizationId = async () => undefined,
  }: {
    repository: SessionGroupsRepository;
    codingAgentSessions: CodingAgentSessionLookup;
    pullRequests?: GithubPullRequestLookup;
    resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
  }) {
    this.repository = repository;
    this.codingAgentSessions = codingAgentSessions;
    this.pullRequests = pullRequests;
    this.resolveOrganizationId = resolveOrganizationId;
  }

  async getSessionGroups(params: SessionGroupsParams): Promise<SessionGroupsResult> {
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
      const dto = mapSessionGroupRowToDto({
        row,
        codingAgent: enrichments[index] ?? null,
      });
      return cutoffMs !== null && row.lastActivityMs < cutoffMs
        ? teasedSession(dto)
        : dto;
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
            .tryGetBySessionId({
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
                    repositoryHost: emptyToNull(session.repositoryHost),
                    repositoryOwner: emptyToNull(session.repositoryOwner),
                    repositoryName: emptyToNull(session.repositoryName),
                    gitBranch: emptyToNull(session.gitBranch),
                    gitWorktree: emptyToNull(session.gitWorktree),
                    title: emptyToNull(session.title),
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
   * Attach each session to the pull request its branch's history says it
   * belongs to, for the whole page in ONE lookup.
   *
   * Best-effort like the enrichment it decorates: an organization that never
   * connected GitHub, a repository no installation reaches, and a failed read
   * all leave the rows unlinked rather than failing the list.
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
    const linkable = linkableSessions({ rows, enrichments });
    if (linkable.length === 0) return;

    try {
      const organizationId = await this.resolveOrganizationId(tenantId);
      if (!organizationId) return;

      const pullRequests = await this.pullRequests.findForBranches({
        organizationId,
        keys: branchKeysOf(linkable),
      });
      if (pullRequests.length === 0) return;

      linkPullRequestsToSessions({ linkable, pullRequests });
    } catch {
      // Unlinked is a correct answer; a failed join must not take the list down.
    }
  }
}
