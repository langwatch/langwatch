import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
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
      }) => Promise<ConversationTraceRef[]>;
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
      return own ? mergeCodingAgentSessionRows([own]) : null;
    }

    const siblings = await this.deps.listConversationTraces({
      tenantId: projectId,
      conversationId,
    });

    const rows = await Promise.all(
      siblings.map((sibling) =>
        this.repository.getByTraceId({
          tenantId: projectId,
          traceId: sibling.traceId,
          startedAtMs: sibling.startedAtMs,
        }),
      ),
    );
    const found = rows.filter(
      (row): row is CodingAgentSessionRow => row !== null,
    );
    return found.length > 0 ? mergeCodingAgentSessionRows(found) : null;
  }
}
