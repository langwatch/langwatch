import {
  defineAggregate,
  defineEvents,
  definePipeline,
  RedisCachedFoldStore,
} from "@langwatch/eventing";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";
import type { CodingAgentCostEstimatorPort } from "../ports/coding-agent-cost-estimator.port";
import type { CodingAgentCostMetricsPort } from "../ports/coding-agent-cost-metrics.port";
import type { CodingAgentProjectActivityPort } from "../ports/coding-agent-project-activity.port";
import type { CodingAgentPullRequestMappingPort } from "../ports/coding-agent-pull-request-mapping.port";
import { createCodingAgentCostDriftSubscriber } from "../subscribers/coding-agent-cost-drift.subscriber";
import { EventingContributeLogFactsAdapter } from "./eventing.contribute-log-facts.adapter";
import { EventingContributeMetricFactsAdapter } from "./eventing.contribute-metric-facts.adapter";
import { EventingContributeSpanFactsAdapter } from "./eventing.contribute-span-facts.adapter";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../projections/coding-agent-session.projection";
import { CodingAgentSessionEventsMapProjection } from "../projections/coding-agent-session-events.projection";
import { CodingAgentTraceSessionsMapProjection } from "../projections/coding-agent-trace-sessions.projection";
import { SessionMetricSeriesMapProjection } from "../projections/session-metric-series.projection";
import {
  CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
  CODING_AGENT_PROCESSING_EVENT_TYPES,
  type CodingAgentProcessingEvent,
} from "@langwatch/coding-agent-contract";
import { createPullRequestMappingSubscriber } from "../subscribers/pull-request-mapping.subscriber";
import { CodingAgentSessionSeenService } from "../services/coding-agent-session-seen.service";
import {
  EventingCodingAgentSessionEventsAppendAdapter,
  EventingCodingAgentTraceSessionAppendAdapter,
  EventingSessionMetricSeriesAppendAdapter,
} from "./eventing.coding-agent-projections.adapter";
import { EventingCodingAgentSessionStoreAdapter } from "./eventing.coding-agent-session-store.adapter";

export interface CodingAgentProcessingPipelineDeps {
  traceCanonicalisation: TraceCanonicalisationService;
  modelProviders: CodingAgentCostEstimatorPort;
  costMetrics: CodingAgentCostMetricsPort;
  projections: CodingAgentProjectionPersistence;
  projects: CodingAgentProjectActivityPort;
  clock: CodingAgentClockPort;
  redis: Redis | Cluster;
  defaultRetentionDays: number;
  /** Typed process configuration for the Redis fold-cache consistency TTL. */
  foldCacheTtlSeconds?: number;
  /**
   * Asks the organization's GitHub connection which pull requests a folded
   * session's branch has hosted. Absent where there is no GitHub connection to
   * ask (the test app), in which case the pipeline mounts no subscriber at all.
   */
  github?: CodingAgentPullRequestMappingPort;
}

/**
 * The session-keyed coding-agent pipeline from ADR-056. Source subscribers
 * contribute bounded span, log, and metric facts; projections persist the
 * session fold, trace map, converged metric series, and ordered session events.
 * GitHub mapping is the only post-fold effect. Session-seen stamping remains
 * an inline, throttled store concern.
 */
export class EventingCodingAgentProcessingAdapter {
  private constructor(private readonly deps: CodingAgentProcessingPipelineDeps) {}

  static create(deps: CodingAgentProcessingPipelineDeps): EventingCodingAgentProcessingAdapter {
    return new EventingCodingAgentProcessingAdapter(deps);
  }

  build() {
    const deps = this.deps;
    const sessionSeen = CodingAgentSessionSeenService.create({
      projects: deps.projects,
      clock: deps.clock,
    });
    const sessionStore = new RedisCachedFoldStore<CodingAgentSessionState>(
      EventingCodingAgentSessionStoreAdapter.create({
        persistence: deps.projections,
        defaultRetentionDays: deps.defaultRetentionDays,
        onSessionsStored: (tenantIds) => sessionSeen.record(tenantIds),
      }),
      deps.redis,
      {
        keyPrefix: "coding_agent_sessions",
        ttlSeconds: deps.foldCacheTtlSeconds,
      },
    );

    const github = deps.github;
    const builder = definePipeline<CodingAgentProcessingEvent>({
      name: "coding_agent_processing",
      aggregate: defineAggregate({
        type: "coding_agent_session",
        events: defineEvents(CODING_AGENT_PROCESSING_EVENT_TYPES),
      }),
    })
      .withClickHouseFoldProjection(
        CodingAgentSessionFoldProjection.create({
          store: sessionStore,
          traceCanonicalisation: deps.traceCanonicalisation,
          modelProviders: deps.modelProviders,
        }),
      )
      .withClickHouseMapProjection(
        CodingAgentTraceSessionsMapProjection.create({
          store: EventingCodingAgentTraceSessionAppendAdapter.create({
            persistence: deps.projections,
            defaultRetentionDays: deps.defaultRetentionDays,
          }),
        }),
      )
      .withClickHouseMapProjection(
        SessionMetricSeriesMapProjection.create({
          store: EventingSessionMetricSeriesAppendAdapter.create({
            persistence: deps.projections,
            defaultRetentionDays: deps.defaultRetentionDays,
          }),
        }),
      )
      .withClickHouseMapProjection(
        CodingAgentSessionEventsMapProjection.create({
          store: EventingCodingAgentSessionEventsAppendAdapter.create({
            persistence: deps.projections,
            defaultRetentionDays: deps.defaultRetentionDays,
          }),
        }),
      )
      .withEventSubscriber(
        "codingAgentCostDrift",
        createCodingAgentCostDriftSubscriber({
          metrics: deps.costMetrics,
          modelProviders: deps.modelProviders,
          traceCanonicalisation: deps.traceCanonicalisation,
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
      .withCommand("contributeSpanFacts", EventingContributeSpanFactsAdapter, {
        coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
      })
      .withCommand("contributeLogFacts", EventingContributeLogFactsAdapter, {
        coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
      })
      .withCommand("contributeMetricFacts", EventingContributeMetricFactsAdapter, {
        coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
      });

    const configured = github
      ? builder.withProjectionSubscriber(
          "pullRequestMapping",
          createPullRequestMappingSubscriber(github),
        )
      : builder;

    return configured.build();
  }
}

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type CodingAgentProcessingPipeline = ReturnType<
  EventingCodingAgentProcessingAdapter["build"]
>;
