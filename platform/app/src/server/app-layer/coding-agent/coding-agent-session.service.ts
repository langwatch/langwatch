import {
  CODING_AGENT_SESSION_READ_WINDOW_MS,
  type CodingAgentSessionRow,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import {
  normalizeMetricName,
  normalizeTokenType,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-normalization";
import { readWindowAround } from "~/server/event-sourcing/projections/projectionStoreContext";
import type { CodingAgentSessionRepository } from "./repositories/coding-agent-session.repository";
import type {
  CodingAgentSessionEventRow,
  CodingAgentSessionEventsRepository,
  SessionEventsCursor,
} from "./repositories/coding-agent-session-events.repository";
import type { CodingAgentTraceSessionRepository } from "./repositories/coding-agent-trace-session.repository";
import type {
  SessionMetricSeriesRepository,
  SessionMetricTotal,
} from "./repositories/session-metric-series.repository";

/**
 * Ceiling on one session-events page. Every caller is clamped to it here, so
 * a route that forgot to validate, a CLI flag or a future job can never ask
 * ClickHouse for an unbounded scan.
 */
export const MAX_SESSION_EVENTS_PAGE_SIZE = 1000;

function clampSessionEventsLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_SESSION_EVENTS_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SESSION_EVENTS_PAGE_SIZE);
}

/** The "at a glance" personal-usage figures over a period. */
export interface CodingAgentUsageTotals {
  sessionCount: number;
  costUsd: number;
  totalTokens: number;
  activeTimeSec: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
}

/**
 * Read side of the coding-agent session aggregate (ADR-056).
 *
 * A point read of one pre-folded row per session. There is no aggregation
 * here on purpose: the fold already merged the session's traces at ingest —
 * which is the entire reason the aggregate exists. What remains at read time
 * is one honest overlay: a session that sent ONLY metrics has no spans or
 * logs to carry its tokens and cost, so those come from its converged metric
 * series (`session_metric_series`) — and only when the folded value is zero,
 * so a session that DID send spans is never double-counted.
 *
 * The row carries no prompt text, no replies and no tool output — only
 * counters, bounded sets, and the ids (`traceIds`, `sessionId`,
 * `finalRequestId`) that reach the heavy data where it already lives.
 */
export interface CodingAgentSessionServiceDeps {
  sessions: CodingAgentSessionRepository;
  traceSessions: CodingAgentTraceSessionRepository;
  metricSeries: SessionMetricSeriesRepository;
  sessionEvents: CodingAgentSessionEventsRepository;
}

export class CodingAgentSessionService {
  private readonly sessions: CodingAgentSessionRepository;
  private readonly traceSessions: CodingAgentTraceSessionRepository;
  private readonly metricSeries: SessionMetricSeriesRepository;
  private readonly sessionEvents: CodingAgentSessionEventsRepository;

  constructor(deps: CodingAgentSessionServiceDeps) {
    this.sessions = deps.sessions;
    this.traceSessions = deps.traceSessions;
    this.metricSeries = deps.metricSeries;
    this.sessionEvents = deps.sessionEvents;
  }

  /**
   * One session's event sequence (model calls, compactions, rate limits,
   * tool runs, prompts) in time order, keyset-paginated. The raw material
   * for per-call analytics; content stays in the canonical rows.
   *
   * `limit` is clamped to {@link MAX_SESSION_EVENTS_PAGE_SIZE}: callers walk
   * the cursor for more, and no caller gets to size the scan itself.
   *
   * A caller that names no window gets one resolved for it. `TimeUnixMs` is
   * the fact table's partition key, so a read without a bound on it opens
   * every weekly partition the retention holds, cold S3 ones included, to
   * answer about a session that lived for minutes. The session row carries
   * `startedAtMs`, and reading it is a keyed point lookup, so the cheap read
   * buys the bound for the expensive one.
   */
  async getSessionEvents({
    projectId,
    sessionId,
    kinds,
    occurredAt,
    cursor,
    limit,
  }: {
    projectId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: SessionEventsCursor;
    limit: number;
  }): Promise<{
    events: CodingAgentSessionEventRow[];
    nextCursor: SessionEventsCursor | null;
  }> {
    const clampedLimit = clampSessionEventsLimit(limit);
    const window =
      occurredAt ?? (await this.resolveEventsWindow({ projectId, sessionId }));
    const page = await this.sessionEvents.findBySessionId({
      tenantId: projectId,
      sessionId,
      kinds,
      occurredAt: window,
      cursor,
      limit: clampedLimit,
    });
    // A derived window is a hint, not a fact: a session running longer than
    // the declared width has events outside it. Only a first page that came
    // back empty under a hint we invented is retried unbounded, so a long
    // session degrades to a slower read rather than a short answer. An
    // explicit window is the caller's own bound and is never widened, and a
    // cursor page is already anchored by the cursor.
    const derivedWindow = occurredAt === undefined && window !== undefined;
    if (page.events.length > 0 || cursor !== undefined || !derivedWindow) {
      return page;
    }
    return this.sessionEvents.findBySessionId({
      tenantId: projectId,
      sessionId,
      kinds,
      cursor,
      limit: clampedLimit,
    });
  }

  /**
   * The partition-pruning window for a session's events, or undefined when
   * the session has no row to anchor on and the read has to go unbounded.
   */
  private async resolveEventsWindow({
    projectId,
    sessionId,
  }: {
    projectId: string;
    sessionId: string;
  }): Promise<{ fromMs: number; toMs: number } | undefined> {
    const row = await this.sessions.findBySessionId({
      tenantId: projectId,
      sessionId,
    });
    if (row === null) return undefined;
    return readWindowAround({
      anchorMs: row.startedAtMs,
      widthMs: CODING_AGENT_SESSION_READ_WINDOW_MS,
    });
  }

  /**
   * One session by its key, or null. `startedAtMs` is the partition-pruning
   * hint — pass it whenever the caller has it. The window width is the fold's
   * declaration (CODING_AGENT_SESSION_READ_WINDOW_MS), and a windowed miss is
   * retried without the window so a stale hint degrades to a slower read, not
   * a 404 for a session that exists. The retry is intentionally unmetered:
   * unlike the fold path (where a recovery means fold state sat outside a
   * DECLARED width — `es_fold_read_window_fallback_total` tracks that drift),
   * a miss here only says a caller's own hint was stale, and the cost is one
   * slower read.
   */
  async getBySessionId({
    projectId,
    sessionId,
    startedAtMs,
  }: {
    projectId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSessionRow | null> {
    const window =
      startedAtMs !== undefined
        ? readWindowAround({
            anchorMs: startedAtMs,
            widthMs: CODING_AGENT_SESSION_READ_WINDOW_MS,
          })
        : undefined;
    const row =
      (await this.sessions.findBySessionId({
        tenantId: projectId,
        sessionId,
        window,
      })) ??
      (window !== undefined
        ? await this.sessions.findBySessionId({
            tenantId: projectId,
            sessionId,
          })
        : null);
    if (row === null) return null;
    const [overlaid] = await this.withMetricTotals(projectId, [row]);
    return overlaid ?? row;
  }

  /**
   * The session a trace belongs to, or null — two keyed seeks (ADR-056 §4):
   * the (trace → session) map, then the session row, with the mapping's own
   * timestamp seeding the partition hint. Null for any trace that is not a
   * coding agent's — not an error.
   */
  async getSessionForTrace({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<CodingAgentSessionRow | null> {
    const mapping = await this.traceSessions.findByTraceId({
      tenantId: projectId,
      traceId,
    });
    if (mapping === null) return null;
    return this.getBySessionId({
      projectId,
      sessionId: mapping.sessionId,
      startedAtMs: mapping.occurredAtMs,
    });
  }

  /**
   * A project's coding-agent sessions in a period, newest first — the read
   * behind personal-workspace usage (specs/coding-agent/personal-usage.feature).
   * Metric-only sessions are in the list (the fold materializes them) and
   * their cost/tokens overlay from their converged series.
   *
   * Personal usage omits `userId`: the personal project already isolates the
   * user, and the stored UserId is the AGENT's reported identity (an opaque
   * `user.id`), not the LangWatch account — so a userId join here would be
   * against the wrong identity space. `userId` is available for a future
   * shared-project "just my sessions" filter once that identity is mapped.
   */
  async listRecent({
    projectId,
    userId,
    fromMs,
    toMs,
    limit = 50,
  }: {
    projectId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<CodingAgentSessionRow[]> {
    const rows = await this.sessions.findManyRecent({
      tenantId: projectId,
      userId,
      fromMs,
      toMs,
      limit,
    });
    return this.withMetricTotals(projectId, rows, { fromMs, toMs });
  }

  /**
   * Usage totals for a project's coding-agent sessions in a period — the four
   * "at a glance" numbers the personal card shows (cost, tokens, active time,
   * session count), plus what the session produced. Reads the same rows as
   * {@link listRecent} (metric-only sessions included, cost/tokens overlaid),
   * then reduces — so a metric-only session's cost counts here too.
   */
  async getUsageTotals({
    projectId,
    userId,
    fromMs,
    toMs,
  }: {
    projectId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
  }): Promise<CodingAgentUsageTotals> {
    // Bound the scan; a personal month rarely exceeds this, and the totals
    // are "at a glance", not an exact ledger, so a cap is acceptable.
    const rows = await this.listRecent({
      projectId,
      userId,
      fromMs,
      toMs,
      limit: 1000,
    });
    return rows.reduce<CodingAgentUsageTotals>(
      (totals, row) => ({
        sessionCount: totals.sessionCount + 1,
        costUsd: totals.costUsd + row.costUsd,
        totalTokens:
          totals.totalTokens +
          row.inputTokens +
          row.outputTokens +
          row.cacheReadTokens +
          row.cacheCreationTokens,
        activeTimeSec:
          totals.activeTimeSec + row.activeTimeUserSec + row.activeTimeCliSec,
        linesAdded: totals.linesAdded + row.linesAdded,
        linesRemoved: totals.linesRemoved + row.linesRemoved,
        commits: totals.commits + row.commits,
        pullRequests: totals.pullRequests + row.pullRequests,
      }),
      {
        sessionCount: 0,
        costUsd: 0,
        totalTokens: 0,
        activeTimeSec: 0,
        linesAdded: 0,
        linesRemoved: 0,
        commits: 0,
        pullRequests: 0,
      },
    );
  }

  /**
   * Overlay converged metric totals onto sessions whose folded value is
   * zero — the metric-only-session case. Tokens and cost normally come from
   * spans and logs; the metric copy fills in ONLY when those signals never
   * arrived, so nothing is ever double-counted. Best-effort: a failed
   * metric read must not take the session view down.
   */
  private async withMetricTotals(
    projectId: string,
    rows: CodingAgentSessionRow[],
    range?: { fromMs: number; toMs: number },
  ): Promise<CodingAgentSessionRow[]> {
    const needy = rows.filter(
      (row) => row.costUsd === 0 || row.inputTokens + row.outputTokens === 0,
    );
    if (needy.length === 0) return rows;

    const startedAts = needy
      .map((row) => row.startedAtMs)
      .filter((ms) => ms > 0);
    const fromMs =
      (range?.fromMs ??
        (startedAts.length > 0 ? Math.min(...startedAts) : Date.now())) -
      60 * 60 * 1000;
    const toMs =
      (range?.toMs ??
        (startedAts.length > 0 ? Math.max(...startedAts) : Date.now())) +
      7 * 24 * 60 * 60 * 1000;

    let totals: SessionMetricTotal[];
    try {
      totals = await this.metricSeries.findTotalsBySessionIds({
        tenantId: projectId,
        sessionIds: needy.map((row) => row.sessionId),
        fromMs,
        toMs,
      });
    } catch {
      return rows;
    }
    if (totals.length === 0) return rows;

    const bySession = new Map<string, SessionMetricTotal[]>();
    for (const totalRow of totals) {
      const list = bySession.get(totalRow.sessionId) ?? [];
      list.push(totalRow);
      bySession.set(totalRow.sessionId, list);
    }

    return rows.map((row) => {
      const sessionTotals = bySession.get(row.sessionId);
      if (!sessionTotals) return row;
      const filled = foldTokenAndCostTotals(sessionTotals);
      return {
        ...row,
        costUsd: row.costUsd || filled.costUsd,
        inputTokens: row.inputTokens || filled.inputTokens,
        outputTokens: row.outputTokens || filled.outputTokens,
        cacheReadTokens: row.cacheReadTokens || filled.cacheReadTokens,
        cacheCreationTokens:
          row.cacheCreationTokens || filled.cacheCreationTokens,
      };
    });
  }
}

/**
 * Token buckets and cost from a session's converged series, through the same
 * vocabulary the fold uses (Codex `total` and Gemini `tool` buckets map to
 * null and are never summed).
 */
function foldTokenAndCostTotals(totals: SessionMetricTotal[]): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  const folded = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  for (const total of totals) {
    const metric = normalizeMetricName(total.metricName);
    if (metric === "cost_usage") {
      folded.costUsd += total.total;
      continue;
    }
    if (metric !== "token_usage") continue;
    switch (normalizeTokenType(total.bucket)) {
      case "input":
        folded.inputTokens += total.total;
        break;
      case "output":
        folded.outputTokens += total.total;
        break;
      case "cache_read":
        folded.cacheReadTokens += total.total;
        break;
      case "cache_creation":
        folded.cacheCreationTokens += total.total;
        break;
      default:
        break;
    }
  }
  return folded;
}
