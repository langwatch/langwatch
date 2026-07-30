import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import type { CodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import { definePipeline } from "../..";
import type { FoldCacheClient } from "../../projections/foldCache/foldCacheClient";
import { ContributeLogFactsCommand } from "./commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "./commands/contributeMetricFactsCommand";
import { ContributeSpanFactsCommand } from "./commands/contributeSpanFactsCommand";
import { CodingAgentSessionFoldProjection } from "./projections/codingAgentSession.foldProjection";
import { codingAgentSessionFoldStore } from "./projections/codingAgentSession.store";
import { CodingAgentTraceSessionsMapProjection } from "./projections/codingAgentTraceSessions.mapProjection";
import { SessionMetricSeriesMapProjection } from "./projections/sessionMetricSeries.mapProjection";
import {
  CodingAgentTraceSessionAppendStore,
  SessionMetricSeriesAppendStore,
} from "./projections/stores";
import type { CodingAgentProcessingEvent } from "./schemas/events";

/**
 * ADR-102 — the three store adapters are constructed here, from the
 * three repositories they wrap. A repository crosses `Deps`; the store adapter
 * that adapts it to a projection contract does not, because it is part of what
 * this pipeline *is*.
 */
export interface CodingAgentProcessingPipelineDeps {
  codingAgentSessionRepository: CodingAgentSessionRepository;
  codingAgentTraceSessionRepository: CodingAgentTraceSessionRepository;
  sessionMetricSeriesRepository: SessionMetricSeriesRepository;
  /** ADR-102 — the resolved cache tier, never a redis client. */
  foldCacheClient: FoldCacheClient;
}

/**
 * The coding-agent pipeline (ADR-105).
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
 * - sessionMetricSeries (map) → `session_metric_series`, the converged
 *   per-series totals (replace, never increment — ADR-105)
 *
 * Consumption is subscribers + projections + one process manager (ADR-105).
 * Commands default to per-aggregate grouping, so one session's contributions
 * apply in order.
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
        // Read-through store (ADR-099): the cache tier is the warm read path;
        // on a miss the store reads its own last committed state back from
        // coding_agent_sessions. The delivery path never reads event_log.
        //
        // `cached()` is the only shape, deliberately — the cache is part of the
        // storage design rather than something a call site assembles, which is
        // what let five stores drift into four different read-back gates.
        store: codingAgentSessionFoldStore.cached({
          repository: deps.codingAgentSessionRepository,
          cache: deps.foldCacheClient,
        }),
      }),
    )
    .withMapProjection(
      "codingAgentTraceSessions",
      new CodingAgentTraceSessionsMapProjection({
        store: new CodingAgentTraceSessionAppendStore(
          deps.codingAgentTraceSessionRepository,
        ),
      }),
    )
    .withMapProjection(
      "sessionMetricSeries",
      new SessionMetricSeriesMapProjection({
        store: new SessionMetricSeriesAppendStore(
          deps.sessionMetricSeriesRepository,
        ),
      }),
    )
    .withCommand("contributeSpanFacts", ContributeSpanFactsCommand)
    .withCommand("contributeLogFacts", ContributeLogFactsCommand)
    .withCommand("contributeMetricFacts", ContributeMetricFactsCommand)
    .build();
}
