import type { ClickHouseClient } from "@clickhouse/client";
import { buildFoldProjections, type FoldProjectionRepositories } from "../pipelineRegistry";
import { ReplayService } from "./replayService";
import type { RegisteredFoldProjection } from "./types";
import { TraceSummaryClickHouseRepository } from "../../app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { EvaluationRunClickHouseRepository } from "../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { ExperimentRunStateRepositoryClickHouse } from "../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository";
import { SimulationRunStateRepositoryClickHouse } from "../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { SuiteRunStateRepositoryClickHouse } from "../pipelines/suite-run-processing/repositories/suiteRunState.clickhouse.repository";

export interface ReplayRuntime {
  service: ReplayService;
  projections: RegisteredFoldProjection[];
  close: () => Promise<void>;
}

/**
 * Create a replay runtime with a fixed ClickHouse URL (all tenants use same DB).
 */
export function createReplayRuntime(config: {
  clickhouseUrl: string;
  redisUrl: string;
}): ReplayRuntime {
  const { createClient } = require("@clickhouse/client") as typeof import("@clickhouse/client");
  const client = createClient({
    url: config.clickhouseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  const clientResolver = async () => client;

  return createReplayRuntimeWithResolver({
    clickhouseClientResolver: clientResolver,
    redisUrl: config.redisUrl,
    closeClickhouse: () => client.close(),
  });
}

/**
 * Create a replay runtime with a tenant-aware ClickHouse resolver.
 * Use this when tenants may have separate CH databases.
 */
export function createReplayRuntimeWithResolver(config: {
  clickhouseClientResolver: (tenantId: string) => Promise<ClickHouseClient>;
  redisUrl: string;
  closeClickhouse?: () => Promise<void>;
}): ReplayRuntime {
  const IORedis = require("ioredis") as typeof import("ioredis");
  const redis = new IORedis.default(config.redisUrl, { maxRetriesPerRequest: null });

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
      await config.closeClickhouse?.();
    },
  };
}
