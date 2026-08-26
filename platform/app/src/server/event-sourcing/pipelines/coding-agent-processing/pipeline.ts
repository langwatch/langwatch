import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  throttledWindow,
} from "@langwatch/eventing";
import type { GithubService } from "@langwatch/github-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
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
  createPullRequestMappingHandler,
  PULL_REQUEST_MAPPING_WINDOW_MS,
  pullRequestMappingGroupKey,
  pullRequestMappingJobId,
  shouldMapPullRequests,
} from "./subscribers/pullRequestMapping.subscriber";

export interface CodingAgentProcessingPipelineDeps {
  traceCanonicalisation: TraceCanonicalisationService;
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
  github?: GithubService;
}

/**
 * The session-keyed coding-agent pipeline from ADR-056. Source subscribers
 * contribute bounded span, log, and metric facts; projections persist the
 * session fold, trace map, converged metric series, and ordered session events.
 * GitHub mapping is the only post-fold effect. Session-seen stamping remains
 * an inline, throttled store concern.
 */
export function createCodingAgentProcessingPipeline(
  deps: CodingAgentProcessingPipelineDeps,
) {
  const github = deps.github;
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
        traceCanonicalisation: deps.traceCanonicalisation,
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
    github
      ? builder.withProjectionSubscriber("pullRequestMapping", {
          fold: "codingAgentSession",
          runIn: ["worker"],
          when: (_event, context) => shouldMapPullRequests(context.state, github),
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
          handler: createPullRequestMappingHandler(github),
        })
      : builder
  ).build();
}
