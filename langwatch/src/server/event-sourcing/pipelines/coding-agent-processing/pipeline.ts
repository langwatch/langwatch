import { definePipeline } from "../..";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import { ContributeLogFactsCommand } from "./commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "./commands/contributeMetricFactsCommand";
import { ContributeSpanFactsCommand } from "./commands/contributeSpanFactsCommand";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "./projections/codingAgentSession.foldProjection";
import {
  CodingAgentTraceSessionsMapProjection,
  type CodingAgentTraceSessionRecord,
} from "./projections/codingAgentTraceSessions.mapProjection";
import type { CodingAgentProcessingEvent } from "./schemas/events";

export interface CodingAgentProcessingPipelineDeps {
  /** Redis-cached at registration — see the fold store's no-read-back note. */
  codingAgentSessionStore: FoldProjectionStore<CodingAgentSessionState>;
  codingAgentTraceSessionAppendStore: AppendStore<CodingAgentTraceSessionRecord>;
}

/**
 * The coding-agent pipeline (ADR-056).
 *
 * Aggregate: `coding_agent_session` — aggregateId is the tenant-scoped
 * provider session key (`session.id` / `gen_ai.conversation.id`, normalized),
 * or the trace id when the telemetry carried no session key.
 *
 * Write surface — one contribution command per OTLP signal, dispatched by
 * subscribers mounted on the source pipelines (the durable cross-pipeline
 * bridge ADR-055 established):
 * - contributeSpanFacts:   span ingestion → tool/model-call facts
 * - contributeLogFacts:    log-processing → the lifted scalar vocabulary
 * - contributeMetricFacts: metric-processing → converged per-series totals
 *
 * Projections:
 * - codingAgentSession (fold) → `coding_agent_sessions`, one row per session
 * - codingAgentTraceSessions (map) → `coding_agent_trace_sessions`, the
 *   (TenantId, TraceId) → SessionId seam the trace drawer resolves through
 *
 * Consumption is subscribers + projections + one process manager — no
 * reactors (ADR-056 §3). Commands default to per-aggregate grouping, so one
 * session's contributions apply in order.
 */
export function createCodingAgentProcessingPipeline(
  deps: CodingAgentProcessingPipelineDeps,
) {
  return definePipeline<CodingAgentProcessingEvent>()
    .withName("coding_agent_processing")
    .withAggregateType("coding_agent_session")
    .withFoldProjection(
      "codingAgentSession",
      new CodingAgentSessionFoldProjection({
        store: deps.codingAgentSessionStore,
      }),
    )
    .withMapProjection(
      "codingAgentTraceSessions",
      new CodingAgentTraceSessionsMapProjection({
        store: deps.codingAgentTraceSessionAppendStore,
      }),
    )
    .withCommand("contributeSpanFacts", ContributeSpanFactsCommand)
    .withCommand("contributeLogFacts", ContributeLogFactsCommand)
    .withCommand("contributeMetricFacts", ContributeMetricFactsCommand)
    .build();
}
