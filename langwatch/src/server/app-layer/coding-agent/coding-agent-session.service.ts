import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import {
  normalizeMetricName,
  normalizeTokenType,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-normalization";
import type { CodingAgentSessionRepository } from "./repositories/coding-agent-session.repository";
import type { CodingAgentTraceSessionRepository } from "./repositories/coding-agent-trace-session.repository";
import type {
  SessionMetricSeriesRepository,
  SessionMetricTotal,
} from "./repositories/session-metric-series.repository";

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
export class CodingAgentSessionService {
  constructor(
    private readonly sessions: CodingAgentSessionRepository,
    private readonly traceSessions: CodingAgentTraceSessionRepository,
    private readonly metricSeries: SessionMetricSeriesRepository,
  ) {}

  /**
   * One session by its key, or null. `startedAtMs` is the partition-pruning
   * hint — pass it whenever the caller has it.
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
    const row = await this.sessions.findBySessionId({
      tenantId: projectId,
      sessionId,
      startedAtMs,
    });
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
