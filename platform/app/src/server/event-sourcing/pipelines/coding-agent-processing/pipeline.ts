import { definePipeline } from "../..";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { ContributeLogFactsCommand } from "./commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "./commands/contributeMetricFactsCommand";
import { ContributeSpanFactsCommand } from "./commands/contributeSpanFactsCommand";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "./projections/codingAgentSession.foldProjection";
import {
  type CodingAgentSessionEventRecord,
  CodingAgentSessionEventsMapProjection,
} from "./projections/codingAgentSessionEvents.mapProjection";
import {
  type CodingAgentTraceSessionRecord,
  CodingAgentTraceSessionsMapProjection,
} from "./projections/codingAgentTraceSessions.mapProjection";
import {
  SessionMetricSeriesMapProjection,
  type SessionMetricSeriesRecord,
} from "./projections/sessionMetricSeries.mapProjection";
import { CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH } from "./schemas/constants";
import type { CodingAgentProcessingEvent } from "./schemas/events";

export interface CodingAgentProcessingPipelineDeps {
  /** Redis-cached at registration — see the fold store's no-read-back note. */
  codingAgentSessionStore: FoldProjectionStore<CodingAgentSessionState>;
  codingAgentTraceSessionAppendStore: AppendStore<CodingAgentTraceSessionRecord>;
  sessionMetricSeriesAppendStore: AppendStore<SessionMetricSeriesRecord>;
  codingAgentSessionEventsAppendStore: AppendStore<CodingAgentSessionEventRecord>;
  /**
   * Asks the organization's GitHub connection which pull requests a folded
   * session's branch has hosted. Absent where there is no GitHub connection to
   * ask (the test app), in which case the pipeline mounts no reactor at all.
   */
  pullRequestMappingReactor?: ReactorDefinition<
    CodingAgentProcessingEvent,
    CodingAgentSessionState
  >;
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
 * - sessionMetricSeries (map) → `session_metric_series`, the converged
 *   per-series totals (replace, never increment — ADR-056 §5)
 * - codingAgentSessionEvents (map) → `coding_agent_session_events`, one row
 *   per session event (model call, compaction, rate limit, tool run, …),
 *   the per-call sequence the session fold's converged totals erase
 *
 * Consumption is subscribers + projections, plus one reactor on the session
 * fold: pullRequestMapping, which asks the organization's GitHub connection
 * about the session's branch once the row is committed — a genuine side
 * effect that earns the queue hop. Recording on the project that a session
 * ran at all is NOT a reactor: the fold store stamps it inline after a commit
 * (`codingAgentSessionSeen.touch.ts`), the same seam-level throttled write the
 * gateway spend pipeline uses for virtual-key lastUsedAt. Commands default to
 * per-aggregate grouping, so one session's contributions apply in order.
 */
export function createCodingAgentProcessingPipeline(
  deps: CodingAgentProcessingPipelineDeps,
) {
  const builder = definePipeline<CodingAgentProcessingEvent>()
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
    .withMapProjection(
      "sessionMetricSeries",
      new SessionMetricSeriesMapProjection({
        store: deps.sessionMetricSeriesAppendStore,
      }),
    )
    .withMapProjection(
      "codingAgentSessionEvents",
      new CodingAgentSessionEventsMapProjection({
        store: deps.codingAgentSessionEventsAppendStore,
      }),
    )
    // ADR-066 pillar 2: every contribution is keyed on its session, so one
    // session is one queue group and a long run drains its transcript one tiny
    // insert at a time. Fold the group's queued contributions into a single
    // multi-row append instead.
    //
    // Safe to fold, and safe ONLY as a fold: coalescing preserves the group's
    // order (the drain takes the head in score order and the batch is handled,
    // appended and dispatched in that order), which this pipeline needs.
    // Sharding the session key would not preserve it; see the note above
    // `CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH` and the derivation's
    // model-call chain. Each handler derives its event from its own command
    // alone and never reads back a same-batch append.
    .withCommand("contributeSpanFacts", ContributeSpanFactsCommand, {
      coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
    })
    .withCommand("contributeLogFacts", ContributeLogFactsCommand, {
      coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
    })
    .withCommand("contributeMetricFacts", ContributeMetricFactsCommand, {
      coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
    });

  return (
    deps.pullRequestMappingReactor
      ? builder.withReactor(
          "codingAgentSession",
          "pullRequestMapping",
          deps.pullRequestMappingReactor,
        )
      : builder
  ).build();
}
