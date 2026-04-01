import IORedis from "ioredis";
import { buildFoldProjections, type FoldProjectionRepositories } from "../pipelineRegistry";
import { ReplayService } from "./replayService";
import type { RegisteredFoldProjection } from "./types";
import { TraceSummaryClickHouseRepository } from "../../app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { EvaluationRunClickHouseRepository } from "../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { ExperimentRunStateRepositoryClickHouse } from "../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository";
import { SimulationRunStateRepositoryClickHouse } from "../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { SuiteRunStateRepositoryClickHouse } from "../pipelines/suite-run-processing/repositories/suiteRunState.clickhouse.repository";
import { getClickHouseClientForProject } from "../../clickhouse/clickhouseClient";

export interface ReplayRuntime {
  service: ReplayService;
  projections: RegisteredFoldProjection[];
  close: () => Promise<void>;
}

/**
 * Create a replay runtime using the app's tenant-aware ClickHouse resolver.
 * Every CH query routes through getClickHouseClientForProject, which
 * resolves project → org → private CH instance (or shared fallback).
 */
export function createReplayRuntime(config: {
  redisUrl: string;
}): ReplayRuntime {
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const clientResolver = async (tenantId: string) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error(`No ClickHouse client available for tenant ${tenantId}`);
    return client;
  };

  const repos: FoldProjectionRepositories = {
    traceSummaryFold: new TraceSummaryClickHouseRepository(clientResolver),
    evaluationRun: new EvaluationRunClickHouseRepository(clientResolver),
    experimentRunState: new ExperimentRunStateRepositoryClickHouse(clientResolver),
    simulationRunState: new SimulationRunStateRepositoryClickHouse(clientResolver),
    suiteRunState: new SuiteRunStateRepositoryClickHouse(clientResolver),
  };

  const projections = buildFoldProjections(repos);
  const service = new ReplayService({ clickhouseClientResolver: clientResolver, redis });

  return {
    service,
    projections,
    close: async () => {
      redis.disconnect();
    },
  };
}
