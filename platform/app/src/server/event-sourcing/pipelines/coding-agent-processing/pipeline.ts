import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  type TriggerContext,
  throttledWindow,
} from "@langwatch/eventing";
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
import {
  CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
  CODING_AGENT_PROCESSING_EVENT_TYPES,
} from "./schemas/constants";
import type { CodingAgentProcessingEvent } from "./schemas/events";
import {
  PULL_REQUEST_MAPPING_WINDOW_MS,
  pullRequestMappingGroupKey,
  pullRequestMappingJobId,
  shouldMapPullRequests,
} from "./subscribers/pullRequestMapping.subscriber";

export interface CodingAgentProcessingPipelineDeps {
  /** Redis-cached at registration — see the fold store's no-read-back note. */
  codingAgentSessionStore: FoldProjectionStore<CodingAgentSessionState>;
  codingAgentTraceSessionAppendStore: AppendStore<CodingAgentTraceSessionRecord>;
  sessionMetricSeriesAppendStore: AppendStore<SessionMetricSeriesRecord>;
  codingAgentSessionEventsAppendStore: AppendStore<CodingAgentSessionEventRecord>;
  /**
   * Asks the organization's GitHub connection which pull requests a folded
   * session's branch has hosted. Absent where there is no GitHub connection to
   * ask (the test app), in which case the pipeline mounts no subscriber at all.
   */
  pullRequestMappingHandler?: (
    event: CodingAgentProcessingEvent,
    context: TriggerContext<CodingAgentSessionState>,
  ) => Promise<void>;
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
 * Consumption is subscribers + projections, plus one subscriber on the session
 * fold: pullRequestMapping, which asks the organization's GitHub connection
 * about the session's branch once the row is committed — a genuine side
 * effect that earns the queue hop. Recording on the project that a session
 * ran at all is NOT a subscriber: the fold store stamps it inline after a commit
 * (`codingAgentSessionSeen.touch.ts`), the same seam-level throttled write the
 * gateway spend pipeline uses for virtual-key lastUsedAt. Commands default to
 * per-aggregate grouping, so one session's contributions apply in order.
 */
export function createCodingAgentProcessingPipeline(
  deps: CodingAgentProcessingPipelineDeps,
) {
  const builder = definePipeline<CodingAgentProcessingEvent>({
    name: "coding_agent_processing",
    aggregate: defineAggregate({
      type: "coding_agent_session",
      events: defineEvents(CODING_AGENT_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      new CodingAgentSessionFoldProjection({
        store: deps.codingAgentSessionStore,
      }),
    )
    .withClickHouseMapProjection(
      new CodingAgentTraceSessionsMapProjection({
        store: deps.codingAgentTraceSessionAppendStore,
      }),
    )
    .withClickHouseMapProjection(
      new SessionMetricSeriesMapProjection({
        store: deps.sessionMetricSeriesAppendStore,
      }),
    )
    .withClickHouseMapProjection(
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
    deps.pullRequestMappingHandler
      ? builder.withProjectionSubscriber("pullRequestMapping", {
          fold: "codingAgentSession",
          runIn: ["worker"],
          when: (_event, context) => shouldMapPullRequests(context.state),
          groupKeyFn: (event, state) =>
            pullRequestMappingGroupKey({
              tenantId: event.tenantId,
              state: state as CodingAgentSessionState,
            }),
          // The window is the collapse for a live burst; the TTL is the
          // throttle for everything else. A subscriber's ready score is the
          // event's own `createdAt`, so a group draining a backlog stages jobs
          // whose `createdAt + delay` deadline has already passed: they
          // dispatch immediately and the window collapses nothing. Honoring
          // the still-live TTL past dispatch is what keeps that case to one
          // GitHub call.
          //
          // Safe against the level-triggered objection, which is why
          // `shouldSurviveDispatch` defaults to false: what it discards is a
          // re-trigger arriving within THIRTY SECONDS of a call that asked
          // GitHub the identical question about the identical branch. Nothing
          // a reader could act on changes inside that window, and the durable
          // bookkeeping refuses to re-ask about a freshly mapped branch for
          // fifteen minutes anyway, so the dropped trigger would have been
          // skipped by the service one layer down.
          ...throttledWindow<CodingAgentProcessingEvent>({
            makeId: (event, state) =>
              pullRequestMappingJobId({
                tenantId: event.tenantId,
                state: state as CodingAgentSessionState,
              }),
            windowMs: PULL_REQUEST_MAPPING_WINDOW_MS,
            shouldSurviveDispatch: true,
          }),
          handler: (event, context) => deps.pullRequestMappingHandler!(event, context),
        })
      : builder
  ).build();
}
