import { createClient, type ClickHouseClient } from "@clickhouse/client";
import IORedis from "ioredis";
import { buildFoldProjections, type FoldProjectionRepositories } from "../pipelineRegistry";
import { ReplayService } from "./replayService";
import type { RegisteredFoldProjection } from "./types";
import { TraceSummaryClickHouseRepository } from "../../app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { EvaluationRunClickHouseRepository } from "../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { ExperimentRunStateRepositoryClickHouse } from "../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository";
import { SimulationRunStateRepositoryClickHouse } from "../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { SuiteRunStateRepositoryClickHouse } from "../pipelines/suite-run-processing/repositories/suiteRunState.clickhouse.repository";
import type { ClickHouseClientResolver } from "../../clickhouse/clickhouseClient";

export interface ReplayRuntime {
  service: ReplayService;
  projections: RegisteredFoldProjection[];
  close: () => Promise<void>;
}

/**
 * Create a replay runtime with a tenant-aware ClickHouse resolver.
 */
export function createReplayRuntimeWithResolver(config: {
  clickhouseClientResolver: ClickHouseClientResolver;
  redisUrl: string;
  close?: () => Promise<void>;
}): ReplayRuntime {
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const repos: FoldProjectionRepositories = {
    traceSummaryFold: new TraceSummaryClickHouseRepository(config.clickhouseClientResolver),
    evaluationRun: new EvaluationRunClickHouseRepository(config.clickhouseClientResolver),
    experimentRunState: new ExperimentRunStateRepositoryClickHouse(config.clickhouseClientResolver),
    simulationRunState: new SimulationRunStateRepositoryClickHouse(config.clickhouseClientResolver),
    suiteRunState: new SuiteRunStateRepositoryClickHouse(config.clickhouseClientResolver),
  };

  const projections = buildFoldProjections(repos);
  const service = new ReplayService({ clickhouseClientResolver: config.clickhouseClientResolver, redis });

  return {
    service,
    projections,
    close: async () => {
      redis.disconnect();
      await config.close?.();
    },
  };
}

/**
 * Create a replay runtime with a single ClickHouse URL (all tenants same DB).
 * For local dev or when you know all target tenants share one database.
 */
export function createReplayRuntime(config: {
  clickhouseUrl: string;
  redisUrl: string;
}): ReplayRuntime {
  const client = createClient({
    url: config.clickhouseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });

  return createReplayRuntimeWithResolver({
    clickhouseClientResolver: async () => client,
    redisUrl: config.redisUrl,
    close: () => client.close(),
  });
}
