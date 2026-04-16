import IORedis from "ioredis";
import { getApp } from "../../app-layer/app";
import { ReplayService } from "./replayService";
import type { RegisteredFoldProjection, RegisteredMapProjection } from "./types";
import { TraceSummaryClickHouseRepository } from "../../app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { TraceSummaryStore } from "../pipelines/trace-processing/projections/traceSummary.store";
import { EvaluationRunClickHouseRepository } from "../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { EvaluationRunStore } from "../pipelines/evaluation-processing/projections/evaluationRun.store";
import { ExperimentRunStateRepositoryClickHouse } from "../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository";
import { createExperimentRunStateFoldStore } from "../pipelines/experiment-run-processing/projections/experimentRunState.store";
import { SimulationRunStateRepositoryClickHouse } from "../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { SuiteRunStateRepositoryClickHouse } from "../pipelines/suite-run-processing/repositories/suiteRunState.clickhouse.repository";
import { RepositoryFoldStore } from "../projections/repositoryFoldStore";
import { SIMULATION_PROJECTION_VERSIONS } from "../pipelines/simulation-processing/schemas/constants";
import { SUITE_RUN_PROJECTION_VERSIONS } from "../pipelines/suite-run-processing/schemas/constants";
import { getClickHouseClientForProject } from "../../clickhouse/clickhouseClient";
import type { FoldProjectionStore } from "../projections/foldProjection.types";

export interface ReplayRuntime {
  service: ReplayService;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  close: () => Promise<void>;
}

/**
 * Map projection → target ClickHouse table for post-replay `OPTIMIZE TABLE`.
 * Add entries here as more map projections become replay-able.
 */
const MAP_TARGET_TABLE: Record<string, string> = {
  spanStorage: "stored_spans",
  logRecordStorage: "stored_log_records",
  metricRecordStorage: "stored_metric_records",
};

/**
 * Create a replay runtime using the app's tenant-aware ClickHouse resolver.
 * Every CH query routes through getClickHouseClientForProject, which
 * resolves project → org → private CH instance (or shared fallback).
 *
 * Iterates the live pipeline definitions from the EventSourcing runtime and
 * re-creates each fold projection with a raw CH store (no Redis cache).
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

  // Raw CH stores (no Redis cache) — keyed by pipeline name
  const storeByPipeline = new Map<string, FoldProjectionStore<any>>([
    ["trace_processing", new TraceSummaryStore(new TraceSummaryClickHouseRepository(clientResolver))],
    ["evaluation_processing", new EvaluationRunStore(new EvaluationRunClickHouseRepository(clientResolver))],
    ["experiment_run_processing", createExperimentRunStateFoldStore(new ExperimentRunStateRepositoryClickHouse(clientResolver))],
    ["simulation_processing", new RepositoryFoldStore(new SimulationRunStateRepositoryClickHouse(clientResolver), SIMULATION_PROJECTION_VERSIONS.RUN_STATE)],
    ["suite_run_processing", new RepositoryFoldStore(new SuiteRunStateRepositoryClickHouse(clientResolver), SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE)],
  ]);

  const definitions = getApp().eventSourcing?.definitions ?? [];
  const projections: RegisteredFoldProjection[] = [];
  const mapProjections: RegisteredMapProjection[] = [];

  for (const def of definitions) {
    const { name: pipelineName, aggregateType } = def.metadata;
    const store = storeByPipeline.get(pipelineName);
    if (!store) continue; // global/billing pipelines — no CH replay needed

    for (const [, { definition: foldDef }] of def.foldProjections) {
      // Clone the projection with the raw CH store instead of the Redis-cached one
      const replayDef = Object.create(foldDef, {
        store: { value: store, writable: true },
      });
      projections.push({
        projectionName: foldDef.name,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: replayDef,
        pauseKey: `${pipelineName}/projection/${foldDef.name}`,
      });
    }

    for (const [, { definition: mapDef }] of def.mapProjections) {
      // Map projections use their own AppendStore directly — it writes straight
      // to ClickHouse with no Redis-cache layer to swap out, unlike folds.
      mapProjections.push({
        projectionName: mapDef.name,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: mapDef,
        pauseKey: `${pipelineName}/projection/${mapDef.name}`,
        targetTable: MAP_TARGET_TABLE[mapDef.name],
      });
    }
  }

  const service = new ReplayService({ clickhouseClientResolver: clientResolver, redis });

  return {
    service,
    projections,
    mapProjections,
    close: async () => {
      redis.disconnect();
    },
  };
}
