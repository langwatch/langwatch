import IORedis from "ioredis";
import { getApp } from "../../app-layer/app";
import { EvaluationRunClickHouseRepository } from "../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "../../app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { EvaluationRunStore } from "../pipelines/evaluation-processing/projections/evaluationRun.store";
import { createExperimentRunStateFoldStore } from "../pipelines/experiment-run-processing/projections/experimentRunState.store";
import { ExperimentRunStateRepositoryClickHouse } from "../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository";
import { SimulationRunStateRepositoryClickHouse } from "../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { SIMULATION_PROJECTION_VERSIONS } from "../pipelines/simulation-processing/schemas/constants";
import { SuiteRunStateRepositoryClickHouse } from "../pipelines/suite-run-processing/repositories/suiteRunState.clickhouse.repository";
import { SUITE_RUN_PROJECTION_VERSIONS } from "../pipelines/suite-run-processing/schemas/constants";
import { TraceSummaryStore } from "../pipelines/trace-processing/projections/traceSummary.store";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import { RepositoryFoldStore } from "../projections/repositoryFoldStore";
import { ReplayService } from "./replayService";
import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
} from "./types";

export interface ReplayRuntime {
  service: ReplayService;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  /**
   * Discovered `.withProjection()` operational state projections, carrying
   * their definition and store for a paused, from-init canonical rebuild.
   */
  stateProjections: RegisteredStateProjection[];
  close: () => Promise<void>;
}

/**
 * Map projection → target ClickHouse table for post-replay `OPTIMIZE TABLE`.
 * Add entries here as more map projections become replay-able.
 */
const MAP_TARGET_TABLE: Record<string, string> = {
  spanStorage: "stored_spans",
  canonicalLogStorage: "log_records",
  metricDataPointStorage: "metric_data_points",
  metricSeriesCatalog: "metric_series",
  metricTimeRollup: "metric_time_rollups",
};

/** Pipelines with no fold store whose map projections still replay. */
const STORELESS_REPLAYABLE = new Set(["metric_processing", "log_processing"]);

type ClickHouseClientResolver = ReturnType<
  typeof getApp
>["clickhouse"]["resolveClient"];
type PipelineDefinitions = NonNullable<
  ReturnType<typeof getApp>["eventSourcing"]
>["definitions"];
type PipelineDefinition = PipelineDefinitions[number];

/** Raw CH stores (no Redis cache) — keyed by pipeline name. */
function buildStoreByPipeline(
  clientResolver: ClickHouseClientResolver,
): Map<string, FoldProjectionStore<any>> {
  return new Map<string, FoldProjectionStore<any>>([
    [
      "trace_processing",
      new TraceSummaryStore(
        new TraceSummaryClickHouseRepository(clientResolver),
      ),
    ],
    [
      "evaluation_processing",
      new EvaluationRunStore(
        new EvaluationRunClickHouseRepository(clientResolver),
      ),
    ],
    [
      "experiment_run_processing",
      createExperimentRunStateFoldStore(
        new ExperimentRunStateRepositoryClickHouse(clientResolver),
      ),
    ],
    [
      "simulation_processing",
      new RepositoryFoldStore(
        new SimulationRunStateRepositoryClickHouse(clientResolver),
        SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      ),
    ],
    [
      "suite_run_processing",
      new RepositoryFoldStore(
        new SuiteRunStateRepositoryClickHouse(clientResolver),
        SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
      ),
    ],
  ]);
}

/**
 * State projections read the SAME canonical event_log as folds, but write to
 * their own (Postgres) StateProjectionStore rather than a CH fold store — so
 * discovery is independent of the CH-store map.
 */
function discoverStateProjections(
  definitions: PipelineDefinitions,
): RegisteredStateProjection[] {
  const stateProjections: RegisteredStateProjection[] = [];
  for (const def of definitions) {
    const { name: pipelineName, aggregateType } = def.metadata;
    for (const [, stateDef] of def.stateProjections ?? []) {
      stateProjections.push({
        projectionName: stateDef.name,
        pipelineName,
        aggregateType,
        source: "pipeline",
        definition: stateDef,
        // State projections enqueue with `__jobType=stateProjection`.
        pauseKey: `${pipelineName}/stateProjection/${stateDef.name}`,
        kind: "state",
      });
    }
  }
  return stateProjections;
}

function discoverFoldProjections(params: {
  def: PipelineDefinition;
  pipelineName: string;
  aggregateType: string;
  store: FoldProjectionStore<any>;
}): RegisteredFoldProjection[] {
  const { def, pipelineName, aggregateType, store } = params;
  const projections: RegisteredFoldProjection[] = [];
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
      // Folds enqueue with `__jobType=projection`; pause middle segment matches.
      pauseKey: `${pipelineName}/projection/${foldDef.name}`,
      kind: "fold",
    });
  }
  return projections;
}

function discoverMapProjections(params: {
  def: PipelineDefinition;
  pipelineName: string;
  aggregateType: string;
}): RegisteredMapProjection[] {
  const { def, pipelineName, aggregateType } = params;
  const mapProjections: RegisteredMapProjection[] = [];
  for (const [, { definition: mapDef }] of def.mapProjections) {
    // Map projections use their own AppendStore directly — it writes straight
    // to ClickHouse with no Redis-cache layer to swap out, unlike folds.
    mapProjections.push({
      projectionName: mapDef.name,
      pipelineName,
      aggregateType,
      source: "pipeline",
      definition: mapDef,
      // Maps enqueue with `__jobType=handler`; the dispatcher Lua script
      // checks `{pipeline}/handler/{name}`, so the pauseKey must follow suit.
      pauseKey: `${pipelineName}/handler/${mapDef.name}`,
      kind: "map",
      targetTable: MAP_TARGET_TABLE[mapDef.name],
    });
  }
  return mapProjections;
}

function discoverFoldAndMapProjections(params: {
  definitions: PipelineDefinitions;
  storeByPipeline: Map<string, FoldProjectionStore<any>>;
}): {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
} {
  const { definitions, storeByPipeline } = params;
  const projections: RegisteredFoldProjection[] = [];
  const mapProjections: RegisteredMapProjection[] = [];

  for (const def of definitions) {
    const { name: pipelineName, aggregateType } = def.metadata;
    const store = storeByPipeline.get(pipelineName);
    if (!store && !STORELESS_REPLAYABLE.has(pipelineName)) continue;

    if (store) {
      projections.push(
        ...discoverFoldProjections({ def, pipelineName, aggregateType, store }),
      );
    }
    mapProjections.push(
      ...discoverMapProjections({ def, pipelineName, aggregateType }),
    );
  }

  return { projections, mapProjections };
}

/**
 * Create a replay runtime using the app's tenant-aware ClickHouse resolver.
 * Every CH query routes through `getApp().clickhouse.resolveClient` — the
 * same resolver every other repository is built from — which resolves
 * project → org → private CH instance (or shared fallback).
 *
 * Iterates the live pipeline definitions from the EventSourcing runtime and
 * re-creates each fold projection with a raw CH store (no Redis cache).
 */
export function createReplayRuntime(config: {
  redisUrl: string;
}): ReplayRuntime {
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const clientResolver = getApp().clickhouse.resolveClient;
  const storeByPipeline = buildStoreByPipeline(clientResolver);
  const definitions = getApp().eventSourcing?.definitions ?? [];

  const stateProjections = discoverStateProjections(definitions);
  const { projections, mapProjections } = discoverFoldAndMapProjections({
    definitions,
    storeByPipeline,
  });

  const service = new ReplayService({
    clickhouseClientResolver: clientResolver,
    redis,
    // Reuse the live pipeline's cached resolver so replay-rebuilt rows honour
    // the same per-tenant retention as live ingestion.
    retentionPolicyResolver: getApp().retentionPolicyCache,
  });

  return {
    service,
    projections,
    mapProjections,
    stateProjections,
    close: async () => {
      redis.disconnect();
    },
  };
}
