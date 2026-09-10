import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import { ClickHouseCodingAgentRepositories } from "../clickhouse/clickhouse.coding-agent.repositories.ts";
import { CodingAgentProjectionPersistenceService } from "../../services/coding-agent-projection-persistence.service.ts";
import { SystemCodingAgentClockAdapter } from "../../services/coding-agent-clock.service.ts";
import {
  EventingCodingAgentProcessingAdapter,
  type CodingAgentProcessingPipeline,
} from "./redis.coding-agent-session-pipeline.repository.ts";
import { ModelCatalogCostEstimatorAdapter } from "../../services/model-catalog-cost-estimator.service.ts";
import { OtelCodingAgentCostMetricsAdapter } from "../../services/coding-agent-cost-metrics.service.ts";
import {
  CodingAgentClickHouse,
  type CodingAgentClickHouseClient,
} from "../../app/coding-agent.members.ts";
import type { CodingAgentProjectActivity } from "../../app/coding-agent.members.ts";
import type { CodingAgentPullRequestMapping } from "../../app/coding-agent.members.ts";

/** Binds the feature's ClickHouse port to a process's tenant-keyed resolver. */
class ResolvedCodingAgentClickHouse implements CodingAgentClickHouse {
  static create(
    resolveClient: (tenantId: string) => Promise<CodingAgentClickHouseClient>,
  ): ResolvedCodingAgentClickHouse {
    return new ResolvedCodingAgentClickHouse(resolveClient);
  }

  private constructor(
    private readonly resolveClient: (tenantId: string) => Promise<CodingAgentClickHouseClient>,
  ) {
  }

  resolve(tenantId: string): Promise<CodingAgentClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}

export type RedisCodingAgentProcessingRepositoryOptions = {
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
  projectActivity: CodingAgentProjectActivity;
  /**
   * The GitHub demand path the mapping subscriber asks.
   */
  pullRequestMapping?: CodingAgentPullRequestMapping;
};

/**
 * Durable coding-agent session processing (ADR-056), composed from a
 * tenant-keyed ClickHouse client and the process's own Redis.
 */
export class RedisCodingAgentProcessingRepository {
  static create(
    options: RedisCodingAgentProcessingRepositoryOptions,
  ): RedisCodingAgentProcessingRepository {
    return new RedisCodingAgentProcessingRepository(options);
  }

  private constructor(private readonly options: RedisCodingAgentProcessingRepositoryOptions) {}

  buildProcessing(): CodingAgentProcessingPipeline {
    const options = this.options;

    return EventingCodingAgentProcessingAdapter.create({
      traceCanonicalisation: options.traceCanonicalisation,
      modelProviders: ModelCatalogCostEstimatorAdapter.create(),
      costMetrics: OtelCodingAgentCostMetricsAdapter.create(),
      projections: CodingAgentProjectionPersistenceService.create(
        ClickHouseCodingAgentRepositories.create({
          clickhouse: ResolvedCodingAgentClickHouse.create(options.resolveClient),
          defaultRetentionDays: options.defaultRetentionDays,
        }),
      ),
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
