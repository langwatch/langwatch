import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import { CodingAgentProjectionPersistenceAdapter } from "./coding-agent.adapter";
import { SystemCodingAgentClockAdapter } from "./coding-agent-clock.adapter";
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
   */
  redis: Redis | Cluster;
  /**
   * The cache's consistency TTL, as the process resolved it.
   */
  foldCacheTtlSeconds?: number;
  /**
   * Canonicalisation of one span or log record, stateless and I/O-free.
   */
  traceCanonicalisation: TraceCanonicalisationService;
  /** The single throttled project write a stored session performs. */
  projectActivity: CodingAgentProjectActivityPort;
  /**
   * The GitHub demand path the mapping subscriber asks.
   */
  pullRequestMapping?: CodingAgentPullRequestMappingPort;
};

/**
 * Durable coding-agent session processing (ADR-056), composed from a
 * tenant-keyed ClickHouse client and the process's own Redis.
 */
export class ClickHouseCodingAgentProcessingAdapter {
  static create(
    options: ClickHouseCodingAgentProcessingAdapterOptions,
  ): ClickHouseCodingAgentProcessingAdapter {
    return new ClickHouseCodingAgentProcessingAdapter(options);
  }

  private constructor(private readonly options: ClickHouseCodingAgentProcessingAdapterOptions) {}

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
      clock: SystemCodingAgentClockAdapter.create(),
      redis: options.redis,
      defaultRetentionDays: options.defaultRetentionDays,
      ...(options.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.foldCacheTtlSeconds }),
      ...(options.pullRequestMapping ? { github: options.pullRequestMapping } : {}),
    }).build();
  }
}
