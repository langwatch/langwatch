import {
  type CodingAgentProjectionPersistence,
  CODING_AGENT_CONTRIBUTION_COALESCE_MAX_BATCH,
  type CodingAgentProcessingEvent,
  spanFactsContributedEventSchema,
  logFactsContributedEventSchema,
  metricFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { TraceApi } from "@langwatch/trace-contract";

import type { CodingAgentApp } from "../app/coding-agent.app.ts";
import type {
  CodingAgentClock,
  CodingAgentCostEstimator,
  CodingAgentCostMetrics,
  CodingAgentProjectActivity,
  CodingAgentPullRequestMapping,
} from "../app/coding-agent.members.ts";
import type { CodingAgentSessionFoldCacheRepository } from "../repositories/coding-agent-session-fold-cache.repository.ts";
import type { CodingAgentRepositories } from "../repositories/coding-agent.repositories.ts";
import type { CodingAgentSessionContextMemoRepository } from "../repositories/session-context-memo.repository.ts";
import {
  EventingCodingAgentSessionEventsAppendAdapter,
  EventingCodingAgentTraceSessionAppendAdapter,
  EventingSessionMetricSeriesAppendAdapter,
} from "../services/coding-agent-projection-append.service.ts";
import { CodingAgentSessionSeenService } from "../services/coding-agent-session-seen.service.ts";
import { EventingCodingAgentSessionStoreAdapter } from "../services/coding-agent-session-store.service.ts";
import { EventingContributeLogFactsAdapter } from "../services/contribute-log-facts.service.ts";
import { EventingContributeMetricFactsAdapter } from "../services/contribute-metric-facts.service.ts";
import { EventingContributeSpanFactsAdapter } from "../services/contribute-span-facts.service.ts";
import { createCodingAgentCostDriftSubscriber } from "./coding-agent-cost-drift.subscriber.ts";
import { CodingAgentSessionEventsMapProjection } from "./coding-agent-session-events.projection.ts";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "./coding-agent-session.projection.ts";
import { CodingAgentTraceSessionsMapProjection } from "./coding-agent-trace-sessions.projection.ts";
import { createPullRequestMappingSubscriber } from "./pull-request-mapping.subscriber.ts";
import { SessionMetricSeriesMapProjection } from "./session-metric-series.projection.ts";

export interface CodingAgentProcessingPipelineDeps {
  traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">;
  modelProviders: CodingAgentCostEstimator;
  costMetrics: CodingAgentCostMetrics;
  projections: CodingAgentProjectionPersistence;
  projects: CodingAgentProjectActivity;
  clock: CodingAgentClock;
  /** The platform default a tenant with no retention override is stamped with, read per write. */
  defaultRetentionDays: () => number;
  sessionContextMemo: CodingAgentSessionContextMemoRepository;
  sessionFoldCache: CodingAgentSessionFoldCacheRepository;
  /** Absent where there is no GitHub connection to ask: no mapping subscriber is mounted. */
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
    const sessionStore = deps.sessionFoldCache.cached<CodingAgentSessionState>(
      EventingCodingAgentSessionStoreAdapter.create({
        persistence: deps.projections,
        defaultRetentionDays: deps.defaultRetentionDays,
        onSessionsStored: (tenantIds) => sessionSeen.record(tenantIds),
      }),
    );

    const github = deps.github;
    const contextMemo = deps.sessionContextMemo;
    const builder = definePipeline({
      name: "coding_agent_processing",
      aggregate: defineAggregate({
        type: "coding_agent_session",
      }),
    })
      .withEvents([
        spanFactsContributedEventSchema,
        logFactsContributedEventSchema,
        metricFactsContributedEventSchema,
      ])
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
      // ADR-066 pillar 2: coalesce contributions preserving order; sharding would break
      // order-dependent model-call derivations. The log lane fills the session-context
      // memo from a declaration; the span lane only reads it.
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

/** The definition this module registers, named so its eventing declaration can hold one. */
export type CodingAgentProcessingPipeline = ReturnType<
  EventingCodingAgentProcessingAdapter["build"]
>;

/**
 * The registration: the app builds the definition once, and the senders are
 * bound back to it once the runtime has built them. The api only sends.
 */
export const codingAgentEventing = defineEventingModule({
  pipeline: "coding_agent_processing",
  build: ({ app }: EventingSetup<CodingAgentRepositories, CodingAgentApp>) =>
    app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
