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
   * One user's sessions in a period, newest first — the personal-usage read
   * (specs/coding-agent/personal-usage.feature). Metric-only sessions are in
   * the list (the fold materializes them) and their cost/tokens overlay from
   * their converged series.
   */
  async listByUser({
    projectId,
    userId,
    fromMs,
    toMs,
    limit = 50,
  }: {
    projectId: string;
    userId: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<CodingAgentSessionRow[]> {
    const rows = await this.sessions.findManyByUser({
      tenantId: projectId,
      userId,
      fromMs,
      toMs,
      limit,
    });
    return this.withMetricTotals(projectId, rows, { fromMs, toMs });
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

    const startedAts = needy.map((row) => row.startedAtMs).filter((ms) => ms > 0);
    const fromMs =
      range?.fromMs ??
      (startedAts.length > 0 ? Math.min(...startedAts) : Date.now()) -
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
