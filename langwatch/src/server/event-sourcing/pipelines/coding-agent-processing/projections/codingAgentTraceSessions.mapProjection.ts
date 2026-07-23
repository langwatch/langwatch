import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "../schemas/events";

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

const events = [
  spanFactsContributedEventSchema,
  logFactsContributedEventSchema,
] as const;

export class CodingAgentTraceSessionsMapProjection
  extends AbstractMapProjection<CodingAgentTraceSessionRecord, typeof events>
  implements MapEventHandlers<typeof events, CodingAgentTraceSessionRecord>
{
  readonly name = "codingAgentTraceSessions";
  readonly store: AppendStore<CodingAgentTraceSessionRecord>;
  protected readonly events = events;

  constructor(deps: { store: AppendStore<CodingAgentTraceSessionRecord> }) {
    super();
    this.store = deps.store;
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
