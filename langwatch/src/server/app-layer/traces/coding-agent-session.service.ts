import type { SeriesTotalByPointAttribute } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import {
  applyMetricToCodingAgentSession,
  createInitCodingAgentSession,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/coding-agent-session.derivation";
import {
  type CodingAgentSession,
  mergeCodingAgentSessionRows,
} from "./coding-agent-session-merge";
import type { CodingAgentSessionRepository } from "./repositories/coding-agent-session.repository";

/** One other trace to check for a coding-agent session row. */
export interface ConversationTraceRef {
  traceId: string;
  startedAtMs: number;
}

/**
 * Read side of the coding-agent session rollup (ADR-041).
 *
 * A point read of one pre-folded row per trace. There is no aggregation
 * WITHIN a trace on purpose: the fold already did it at ingest, which is the
 * entire reason the projection exists — the app, the CLI and the MCP server
 * all want the same session facts, and none of them should be re-walking 800
 * spans to get them.
 *
 * ACROSS traces is a different story: a coding-agent SESSION (the CLI
 * process someone ran) is not always one trace — Claude Code's native
 * tracer usually groups a whole run under one traceId, but a session that
 * crosses a context compaction, a `/clear`, or simply outlives the process
 * (hits its own session limit and continues) produces more than one. Those
 * traces already share LangWatch's own `conversationId` (`gen_ai
 * .conversation.id`) — Claude Code's `session.id` is hoisted onto that
 * exact attribute at normalization time — so finding the session's other
 * traces means asking the SAME conversation-membership question every
 * other conversation-aware feature already answers, not re-deriving
 * membership from a coding-agent-specific id.
 *
 * The row carries no prompt text, no replies and no tool output — only counters,
 * bounded sets, and the ids (`traceId`, `sessionId`, `finalRequestId`) that reach
 * the heavy data where it already lives.
 */
export class CodingAgentSessionService {
  constructor(
    private readonly repository: CodingAgentSessionRepository,
    private readonly deps?: {
      /**
       * Every trace in the given conversation. Structural — callers inject
       * whatever already answers "which traces share this conversationId"
       * (the same lookup `conversationContext` uses), so this service
       * doesn't grow its own copy of conversation membership.
       */
      listConversationTraces: (params: {
        tenantId: string;
        conversationId: string;
        /**
         * The opened trace's start, when known — lets the lookup anchor its
         * time window on the SESSION's era instead of on today, so opening an
         * old session still finds its siblings.
         */
        aroundStartedAtMs?: number;
      }) => Promise<ConversationTraceRef[]>;
      /**
       * Session-keyed metric totals off the canonical metric tables. A coding
       * agent's metrics carry no exemplars, so they can never correlate to a
       * trace — but `session.id` rides the datapoint attributes, which is the
       * ONLY way lines/commits/PRs/edit-decisions/active-time ever reach a
       * session view (ADR-041's known gap, closed at read time).
       */
      getSessionMetricTotals?: (params: {
        tenantId: string;
        sessionId: string;
        fromMs: number;
      }) => Promise<SeriesTotalByPointAttribute[]>;
    },
  ) {}

  /**
   * The session for one trace's CONVERSATION — every trace sharing its
   * `conversationId`, merged into one view — or just that trace alone when
   * `conversationId` is absent or the lookup dependency wasn't supplied.
   * Null when none of the candidate traces are a coding-agent session (the
   * fold writes no row for an ordinary LLM trace — not an error).
   *
   * `startedAtMs` is a partition-pruning hint. Without it ClickHouse scans every
   * partition, including the cold ones on S3.
   */
  async getByTraceId({
    projectId,
    traceId,
    startedAtMs,
    conversationId,
  }: {
    projectId: string;
    traceId: string;
    startedAtMs?: number;
    conversationId?: string | null;
  }): Promise<CodingAgentSession | null> {
    if (!conversationId || !this.deps) {
      const own = await this.repository.getByTraceId({
        tenantId: projectId,
        traceId,
        startedAtMs,
      });
      return own
        ? this.withSessionMetrics(projectId, mergeCodingAgentSessionRows([own]))
        : null;
    }

    const siblings = await this.deps.listConversationTraces({
      tenantId: projectId,
      conversationId,
      aroundStartedAtMs: startedAtMs,
    });

    // The opened trace is part of the merge no matter what the membership
    // listing returned: if the listing was truncated (page cap) or lagged
    // ingestion, dropping the very trace the user is looking at would be the
    // worst possible omission.
    const candidates = siblings.some((sibling) => sibling.traceId === traceId)
      ? siblings
      : [...siblings, { traceId, startedAtMs: startedAtMs ?? 0 }];

    // Bounded fan-out: a long session lists hundreds of sibling traces, and
    // firing every point read at once trips ClickHouse's simultaneous-query
    // limit under drawer traffic.
    const rows: Array<CodingAgentSessionRow | null> = [];
    const readConcurrency = 10;
    for (let i = 0; i < candidates.length; i += readConcurrency) {
      rows.push(
        ...(await Promise.all(
          candidates.slice(i, i + readConcurrency).map((sibling) =>
            this.repository.getByTraceId({
              tenantId: projectId,
              traceId: sibling.traceId,
              startedAtMs: sibling.startedAtMs || undefined,
            }),
          ),
        )),
      );
    }
    const found = rows.filter(
      (row): row is CodingAgentSessionRow => row !== null,
    );
    return found.length > 0
      ? this.withSessionMetrics(
          projectId,
          mergeCodingAgentSessionRows(found),
        )
      : null;
  }

  /**
   * Overlay the session-keyed metric totals onto the merged view — but only
   * onto fields NO other signal feeds. Tokens and cost come from spans and
   * must never be double-counted from the token metric; lines, commits, PRs,
   * edit decisions and active time exist ONLY as metrics, so zero there means
   * "the fold could not see them", not "none happened".
   */
  private async withSessionMetrics(
    projectId: string,
    session: CodingAgentSession,
  ): Promise<CodingAgentSession> {
    if (!this.deps?.getSessionMetricTotals || !session.sessionId) {
      return session;
    }

    let totals: SeriesTotalByPointAttribute[];
    try {
      totals = await this.deps.getSessionMetricTotals({
        tenantId: projectId,
        sessionId: session.sessionId,
        // The metric export lags the session's first span by at most its
        // export interval; an hour of slack is partition pruning, not logic.
        fromMs: session.startedAtMs - 60 * 60 * 1000,
      });
    } catch {
      // Metrics are additive garnish on a session already answered from
      // spans + logs — a failed read must not take the session view down.
      return session;
    }
    if (totals.length === 0) return session;

    // The fold's own metric derivation maps each series total exactly like a
    // metric record: one vocabulary, whether the numbers arrive as events or
    // as rollup sums.
    let folded = createInitCodingAgentSession();
    for (const series of totals) {
      folded = applyMetricToCodingAgentSession({
        state: folded,
        data: {
          metricName: series.metricName,
          value: series.total,
          attributes: series.pointAttributes,
        },
      });
    }

    return {
      ...session,
      linesAdded: session.linesAdded || folded.linesAdded,
      linesRemoved: session.linesRemoved || folded.linesRemoved,
      commits: session.commits || folded.commits,
      pullRequests: session.pullRequests || folded.pullRequests,
      editsAccepted: session.editsAccepted || folded.editsAccepted,
      editsRejected: session.editsRejected || folded.editsRejected,
      languagesEdited:
        session.languagesEdited.length > 0
          ? session.languagesEdited
          : folded.languagesEdited,
      activeTimeUserSec: session.activeTimeUserSec || folded.activeTimeUserSec,
      activeTimeCliSec: session.activeTimeCliSec || folded.activeTimeCliSec,
    };
  }
}
