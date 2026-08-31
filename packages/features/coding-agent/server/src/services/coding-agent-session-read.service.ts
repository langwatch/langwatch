import {
  type CodingAgentRecentSessionsInput,
  codingAgentRecentSessionsInputSchema,
  type CodingAgentSession,
  type CodingAgentSessionCursor,
  type CodingAgentSessionEvent,
  codingAgentSessionEventsInputSchema,
  codingAgentSessionLookupInputSchema,
  codingAgentTraceSessionLookupInputSchema,
  type CodingAgentUsageTotals,
  type CodingAgentUsageTotalsInput,
  codingAgentUsageTotalsInputSchema,
  codingAgentUsageTotalsSchema,
  MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE,
  normalizeMetricName,
  normalizeTokenType,
} from "@langwatch/coding-agent-contract";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import {
  SessionMetricSeriesRepository,
  type SessionMetricTotal,
} from "../repositories/session-metric-series.repository";

export const CODING_AGENT_SESSION_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Private owner of session, trace, metric and event read-model coordination. */
export class CodingAgentSessionReadService {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    traceSessions: CodingAgentTraceSessionRepository;
    metricSeries: SessionMetricSeriesRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    clock: CodingAgentClockPort;
  }): CodingAgentSessionReadService {
    return new CodingAgentSessionReadService(options);
  }

  private constructor(
    private readonly dependencies: {
      sessions: CodingAgentSessionRepository;
      traceSessions: CodingAgentTraceSessionRepository;
      metricSeries: SessionMetricSeriesRepository;
      sessionEvents: CodingAgentSessionEventRepository;
      clock: CodingAgentClockPort;
    },
  ) {}

  async getSessionEvents(input: {
    projectId: string;
    sessionId: string;
    kinds?: string[];
    occurredAt?: { fromMs: number; toMs: number };
    cursor?: { timeUnixMs: number; recordId: string };
    limit: number;
  }): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    const parsed = codingAgentSessionEventsInputSchema.parse(input);
    const limit = CodingAgentSessionReadService.clampSessionEventsLimit(parsed.limit);
    const window =
      parsed.occurredAt ??
      (await this.resolveEventsWindow({
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
      }));
    const page = await this.dependencies.sessionEvents.findBySessionId({
      tenantId: parsed.projectId,
      sessionId: parsed.sessionId,
      kinds: parsed.kinds,
      occurredAt: window,
      cursor: parsed.cursor,
      limit,
    });
    const derivedWindow = parsed.occurredAt === undefined ? window : undefined;
    if (
      page.events.length > 0 ||
      parsed.cursor !== undefined ||
      parsed.kinds !== undefined ||
      !derivedWindow
    ) {
      return page;
    }
    return this.dependencies.sessionEvents.findBySessionId({
      tenantId: parsed.projectId,
      sessionId: parsed.sessionId,
      kinds: parsed.kinds,
      occurredAt: {
        fromMs: derivedWindow.fromMs,
        toMs: Math.max(this.dependencies.clock.nowMs(), derivedWindow.toMs),
      },
      cursor: parsed.cursor,
      limit,
    });
  }

  async tryGetBySessionId(input: {
    projectId: string;
    sessionId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSession | null> {
    const parsed = codingAgentSessionLookupInputSchema.parse(input);
    const window =
      parsed.startedAtMs === undefined
        ? undefined
        : CodingAgentSessionReadService.readWindowAround(parsed.startedAtMs);
    const row =
      (await this.dependencies.sessions.tryFindBySessionId({
        tenantId: parsed.projectId,
        sessionId: parsed.sessionId,
        window,
      })) ??
      (window === undefined
        ? null
        : await this.dependencies.sessions.tryFindBySessionId({
            tenantId: parsed.projectId,
            sessionId: parsed.sessionId,
          }));
    if (row === null) return null;
    const [overlaid] = await this.withMetricTotals(parsed.projectId, [row]);
    return overlaid ?? row;
  }

  async tryGetSessionForTrace(input: {
    projectId: string;
    traceId: string;
  }): Promise<CodingAgentSession | null> {
    const parsed = codingAgentTraceSessionLookupInputSchema.parse(input);
    const mapping = await this.dependencies.traceSessions.tryFindByTraceId({
      tenantId: parsed.projectId,
      traceId: parsed.traceId,
    });
    if (mapping === null) return null;
    return this.tryGetBySessionId({
      projectId: parsed.projectId,
      sessionId: mapping.sessionId,
      startedAtMs: mapping.occurredAtMs,
    });
  }

  async listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    const parsed = codingAgentRecentSessionsInputSchema.parse(input);
    const rows = await this.dependencies.sessions.findManyRecent({
      tenantId: parsed.projectId,
      userId: parsed.userId,
      fromMs: parsed.fromMs,
      toMs: parsed.toMs,
      limit: parsed.limit ?? 50,
    });
    return this.withMetricTotals(parsed.projectId, rows, parsed);
  }

  async getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    const parsed = codingAgentUsageTotalsInputSchema.parse(input);
    const rows = await this.listRecent({ ...parsed, limit: 1000 });
    return codingAgentUsageTotalsSchema.parse(
      rows.reduce<CodingAgentUsageTotals>(
        (totals, row) => ({
          sessionCount: totals.sessionCount + 1,
          costUsd: totals.costUsd + row.costUsd,
          totalTokens:
            totals.totalTokens +
            row.inputTokens +
            row.outputTokens +
            row.cacheReadTokens +
            row.cacheCreationTokens,
          activeTimeSec: totals.activeTimeSec + row.activeTimeUserSec + row.activeTimeCliSec,
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
      ),
    );
  }

  private async resolveEventsWindow(input: {
    projectId: string;
    sessionId: string;
  }): Promise<{ fromMs: number; toMs: number } | undefined> {
    const row = await this.dependencies.sessions.tryFindBySessionId({
      tenantId: input.projectId,
      sessionId: input.sessionId,
    });
    return row === null
      ? undefined
      : CodingAgentSessionReadService.readWindowAround(row.startedAtMs);
  }

  private async withMetricTotals(
    projectId: string,
    rows: CodingAgentSession[],
    range?: { fromMs: number; toMs: number },
  ): Promise<CodingAgentSession[]> {
    const needy = rows.filter(
      (row) => row.costUsd === 0 || row.inputTokens + row.outputTokens === 0,
    );
    if (needy.length === 0) return rows;
    const startedAts = needy.map((row) => row.startedAtMs).filter((ms) => ms > 0);
    const fromMs =
      (range?.fromMs ??
        (startedAts.length > 0 ? Math.min(...startedAts) : this.dependencies.clock.nowMs())) -
      60 * 60 * 1000;
    const toMs =
      (range?.toMs ??
        (startedAts.length > 0 ? Math.max(...startedAts) : this.dependencies.clock.nowMs())) +
      7 * 24 * 60 * 60 * 1000;
    let totals: SessionMetricTotal[];
    try {
      totals = await this.dependencies.metricSeries.findTotalsBySessionIds({
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
    for (const total of totals) {
      const sessionTotals = bySession.get(total.sessionId) ?? [];
      sessionTotals.push(total);
      bySession.set(total.sessionId, sessionTotals);
    }
    return rows.map((row) => {
      const sessionTotals = bySession.get(row.sessionId);
      if (sessionTotals === undefined) return row;
      const filled = CodingAgentSessionReadService.foldTokenAndCostTotals(sessionTotals);
      return {
        ...row,
        costUsd: row.costUsd || filled.costUsd,
        inputTokens: row.inputTokens || filled.inputTokens,
        outputTokens: row.outputTokens || filled.outputTokens,
        cacheReadTokens: row.cacheReadTokens || filled.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens || filled.cacheCreationTokens,
      };
    });
  }

  private static readWindowAround(anchorMs: number): { fromMs: number; toMs: number } {
    return {
      fromMs: anchorMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
      toMs: anchorMs + CODING_AGENT_SESSION_READ_WINDOW_MS,
    };
  }

  private static clampSessionEventsLimit(limit: number): number {
    if (!Number.isFinite(limit)) return MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE;
    return Math.min(Math.max(Math.trunc(limit), 1), MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE);
  }

  private static foldTokenAndCostTotals(totals: SessionMetricTotal[]) {
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
      }
    }
    return folded;
  }
}
