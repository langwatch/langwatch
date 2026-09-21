import {
  type CodingAgentProjectionPersistence,
  CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
  CODING_AGENT_PROCESSING_EVENT_TYPES,
  type CodingAgentProcessingEvent,
} from "@langwatch/coding-agent-contract";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  RedisCachedFoldStore,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";

import type {
  CodingAgentClock,
  CodingAgentCostEstimator,
  CodingAgentCostMetrics,
  CodingAgentProjectActivity,
  CodingAgentPullRequestMapping,
} from "../../app/coding-agent.members.ts";
import { createCodingAgentCostDriftSubscriber } from "../../eventing/coding-agent-cost-drift.subscriber.ts";
import { CodingAgentSessionEventsMapProjection } from "../../eventing/coding-agent-session-events.projection.ts";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../../eventing/coding-agent-session.projection.ts";
import { CodingAgentTraceSessionsMapProjection } from "../../eventing/coding-agent-trace-sessions.projection.ts";
import { createPullRequestMappingSubscriber } from "../../eventing/pull-request-mapping.subscriber.ts";
import { SessionMetricSeriesMapProjection } from "../../eventing/session-metric-series.projection.ts";
import {
  EventingCodingAgentSessionEventsAppendAdapter,
  EventingCodingAgentTraceSessionAppendAdapter,
  EventingSessionMetricSeriesAppendAdapter,
} from "../../services/coding-agent-projection-append.service.ts";
import { CodingAgentSessionSeenService } from "../../services/coding-agent-session-seen.service.ts";
import { EventingCodingAgentSessionStoreAdapter } from "../../services/coding-agent-session-store.service.ts";
import { EventingContributeLogFactsAdapter } from "../../services/contribute-log-facts.service.ts";
import { EventingContributeMetricFactsAdapter } from "../../services/contribute-metric-facts.service.ts";
import { EventingContributeSpanFactsAdapter } from "../../services/contribute-span-facts.service.ts";
import type { CodingAgentSessionContextMemoRepository } from "../session-context-memo.repository.ts";
import { RedisSessionContextMemoRepository } from "./redis.session-context-memo.repository.ts";

export interface CodingAgentProcessingPipelineDeps {
  traceCanonicalisation: TraceCanonicalisationService;
  modelProviders: CodingAgentCostEstimator;
  costMetrics: CodingAgentCostMetrics;
  projections: CodingAgentProjectionPersistence;
  projects: CodingAgentProjectActivity;
  clock: CodingAgentClock;
  redis: Redis | Cluster;
  defaultRetentionDays: number;
  /**
   * The "context the session last declared" store the log-facts command stamps
   * fact rows from. Defaults to the Redis memo over this pipeline's own Redis,
   * which is the only shape a real process has; a test passes the in-memory one.
   */
  sessionContextMemo?: CodingAgentSessionContextMemoRepository;
  /** Typed process configuration for the Redis fold-cache consistency TTL. */
  foldCacheTtlSeconds?: number;
  /**
   * Asks the organization's GitHub connection which pull requests a folded
   * session's branch has hosted. Absent where there is no GitHub connection to
   * ask (the test app), in which case the pipeline mounts no subscriber at all.
   */
  github?: CodingAgentPullRequestMapping;
}

/**
 * The session-keyed coding-agent pipeline from ADR-056. Source subscribers
 * contribute bounded span/log/metric facts; projections persist the fold,
 * trace map, metric series and events. GitHub mapping is the only post-fold effect.
 */
export class EventingCodingAgentProcessingAdapter {
  private constructor(private readonly deps: CodingAgentProcessingPipelineDeps) {}

  static create(deps: CodingAgentProcessingPipelineDeps): EventingCodingAgentProcessingAdapter {
    return new EventingCodingAgentProcessingAdapter(deps);
  }

  build(): StaticPipelineDefinition<
    CodingAgentProcessingEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
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
    const contextMemo =
      deps.sessionContextMemo ?? RedisSessionContextMemoRepository.create(deps.redis);
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
      // ADR-066 pillar 2: coalesce contributions preserving order; sharding
      // would break order-dependent model-call derivations.
      // Instances rather than classes: both contributions carry the
      // session-context memo. The log lane fills it from a declaration and
      // stamps row-bearing records; the span lane only reads it, to stamp the
      // spans that carry a model call.
      .withCommandInstance(
        "contributeSpanFacts",
        EventingContributeSpanFactsAdapter,
        EventingContributeSpanFactsAdapter.create({ contextMemo }),
        { coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH },
      )
      .withCommandInstance(
        "contributeLogFacts",
        EventingContributeLogFactsAdapter,
        EventingContributeLogFactsAdapter.create({ contextMemo }),
        { coalesceMaxBatch: CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH },
      )
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
