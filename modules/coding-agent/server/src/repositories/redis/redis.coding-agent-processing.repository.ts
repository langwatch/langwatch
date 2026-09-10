import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
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
import type { CodingAgentProjectActivity } from "../../app/coding-agent.members.ts";
import type { CodingAgentPullRequestMapping } from "../../app/coding-agent.members.ts";

export type RedisCodingAgentProcessingRepositoryOptions = {
  /**
   * The process's one ClickHouse client. It routes each statement to the
   * server its tenant belongs on, so the pipeline holds no per-tenant client
   * and cannot obtain an unscoped one.
   */
  clickhouse: ClickHouseQueryClient;
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
 * Durable coding-agent session processing (ADR-056), composed from the
 * process's one ClickHouse client and its own Redis.
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
        ClickHouseCodingAgentRepositories.createWith({
          clickhouse: options.clickhouse,
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
