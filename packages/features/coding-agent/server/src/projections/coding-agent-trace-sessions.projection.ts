import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "@langwatch/coding-agent-contract";
import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";

/**
 * One row per (trace, session) pair — the seam the trace drawer resolves its
 * session through (ADR-056 §4): TraceId → SessionId is a keyed seek here,
 * then SessionId → row is a keyed seek on `coding_agent_sessions`, instead
 * of scanning the session table's TraceIds arrays.
 */
export interface CodingAgentTraceSessionRecord {
  tenantId: string;
  traceId: string;
  sessionId: string;
  /** When the contributing signal occurred — the partition key. */
  occurredAtMs: number;
}

const events = [spanFactsContributedEventSchema, logFactsContributedEventSchema] as const;

export class CodingAgentTraceSessionsMapProjection
  extends AbstractMapProjection<CodingAgentTraceSessionRecord, typeof events>
  implements MapEventHandlers<typeof events, CodingAgentTraceSessionRecord>
{
  readonly name = "codingAgentTraceSessions";
  readonly store: AppendStore<CodingAgentTraceSessionRecord>;
  protected readonly events = events;

  private constructor(deps: { store: AppendStore<CodingAgentTraceSessionRecord> }) {
    super();
    this.store = deps.store;
    this.options = {
      coalesceMaxBatch: CODING_AGENT_MAP_COALESCE_MAX_BATCH,
    };
  }

  static create(deps: {
    store: AppendStore<CodingAgentTraceSessionRecord>;
  }): CodingAgentTraceSessionsMapProjection {
    return new CodingAgentTraceSessionsMapProjection(deps);
  }

  mapCodingAgentSessionSpanFactsContributed(
    event: SpanFactsContributedEvent,
  ): CodingAgentTraceSessionRecord {
    return {
      tenantId: event.data.tenantId,
      traceId: event.data.traceId,
      sessionId: event.data.sessionId,
      occurredAtMs: event.data.startTimeUnixMs,
    };
  }

  mapCodingAgentSessionLogFactsContributed(
    event: LogFactsContributedEvent,
  ): CodingAgentTraceSessionRecord | null {
    // A log with no resolved correlation maps no trace; the session fold
    // still counted its facts.
    if (event.data.traceId === null) return null;
    return {
      tenantId: event.data.tenantId,
      traceId: event.data.traceId,
      sessionId: event.data.sessionId,
      occurredAtMs: event.data.timeUnixMs,
    };
  }
}
