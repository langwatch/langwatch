import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import { CodingAgentProjectionPersistenceAdapter } from "./coding-agent.adapter";
import { SystemCodingAgentClock } from "./coding-agent-clock.adapter";
import {
  EventingCodingAgentProcessingAdapter,
  type CodingAgentProcessingPipeline,
} from "./eventing.coding-agent-processing.adapter";
import { ModelCatalogCostEstimatorAdapter } from "./model-catalog.cost-estimator.adapter";
import { OtelCodingAgentCostMetricsAdapter } from "./otel.coding-agent-cost-metrics.adapter";
import {
  CodingAgentClickHousePort,
  type CodingAgentClickHouseClient,
} from "../ports/coding-agent-clickhouse.port";
import type { CodingAgentProjectActivityPort } from "../ports/coding-agent-project-activity.port";
import type { CodingAgentPullRequestMappingPort } from "../ports/coding-agent-pull-request-mapping.port";

/** Binds the feature's ClickHouse port to a process's tenant-keyed resolver. */
class ResolvedCodingAgentClickHousePort extends CodingAgentClickHousePort {
  static create(
    resolveClient: (tenantId: string) => Promise<CodingAgentClickHouseClient>,
  ): ResolvedCodingAgentClickHousePort {
    return new ResolvedCodingAgentClickHousePort(resolveClient);
  }

  private constructor(
    private readonly resolveClient: (tenantId: string) => Promise<CodingAgentClickHouseClient>,
  ) {
    super();
  }

  resolve(tenantId: string): Promise<CodingAgentClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}

export type ClickHouseCodingAgentProcessingAdapterOptions = {
  resolveClient: (tenantId: string) => Promise<CodingAgentClickHouseClient>;
  /** The fallback for rows whose tenant declares no retention override. */
  defaultRetentionDays: number;
  /**
   * The process's own Redis, required rather than optional.
   *
   * The fold cache is not a latency knob here: the session fold accumulates a
   * transcript by addition — tool runs, model calls, tokens and cost — and it
   * carries the applied-event ids a redelivered contribution is dropped on. A
   * graph that composed this pipeline without one would double-count a
   * redelivered batch into a session's totals, so an absent Redis is a
   * composition that must not be expressible.
   */
  redis: Redis | Cluster;
  /**
   * The cache's consistency TTL, as the process resolved it.
   *
   * Read from the same environment variable the App reads, because the App
   * still produces into this pipeline while this process consumes it: two
   * graphs writing one keyspace under different TTLs would expire each other's
   * entries early.
   */
  foldCacheTtlSeconds?: number;
  /**
   * Canonicalisation of one span or log record, stateless and I/O-free.
   *
   * Received rather than built: the concrete service lives in the Trace
   * feature's server package, which a feature package may not import. The
   * composition root that mounts both holds one and passes it here, exactly as
   * it does for the Log pipeline's coding-agent dispatch subscriber.
   */
  traceCanonicalisation: TraceCanonicalisationService;
  /** The single throttled project write a stored session performs. */
  projectActivity: CodingAgentProjectActivityPort;
  /**
   * The GitHub demand path the mapping subscriber asks. Absent where there is
   * no GitHub connection to ask, in which case the pipeline mounts no mapping
   * subscriber at all — which changes the pipeline's routing keys, so a
   * consumer of the shared queue must supply one.
   */
  pullRequestMapping?: CodingAgentPullRequestMappingPort;
};

/**
 * Durable coding-agent session processing (ADR-056), composed from a
 * tenant-keyed ClickHouse client and the process's own Redis.
 *
 * This is the whole seam a background worker needs. The App reached the same
 * pipeline through `PipelineRegistry`, which assembled it from six places at
 * once: the projection persistence built in `presets.ts` over the App's
 * ClickHouse routing, the OTel cost metrics built in the registry, the clock,
 * the platform retention constant, the App's `ModelProviderService` and its
 * `ProjectService`. The last two were the reason nothing outside the App could
 * build it, and neither is asked for here — the fold prices a model call from
 * the immutable catalog, and the session-seen stamp is one throttled `UPDATE`
 * behind a one-method port.
 *
 * There is no ClickHouse-disabled arm. A consumer of `event-sourcing/jobs`
 * without an event store is refused before any capability is built, so the
 * null-repository shape the App composes for a ClickHouse-less install is not
 * a shape this graph can be in.
 */
export class ClickHouseCodingAgentProcessingAdapter {
  static create(
    options: ClickHouseCodingAgentProcessingAdapterOptions,
  ): ClickHouseCodingAgentProcessingAdapter {
    return new ClickHouseCodingAgentProcessingAdapter(options);
  }

  private constructor(
    private readonly options: ClickHouseCodingAgentProcessingAdapterOptions,
  ) {}

  buildProcessing(): CodingAgentProcessingPipeline {
    const options = this.options;

    return EventingCodingAgentProcessingAdapter.create({
      traceCanonicalisation: options.traceCanonicalisation,
      modelProviders: ModelCatalogCostEstimatorAdapter.create(),
      costMetrics: OtelCodingAgentCostMetricsAdapter.create(),
      projections: CodingAgentProjectionPersistenceAdapter.create({
        clickHouse: ResolvedCodingAgentClickHousePort.create(options.resolveClient),
        retention: { defaultTraceRetentionDays: options.defaultRetentionDays },
      }),
      projects: options.projectActivity,
      clock: SystemCodingAgentClock.create(),
      redis: options.redis,
      defaultRetentionDays: options.defaultRetentionDays,
      ...(options.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
      ...(options.pullRequestMapping ? { github: options.pullRequestMapping } : {}),
    }).build();
  }
}
