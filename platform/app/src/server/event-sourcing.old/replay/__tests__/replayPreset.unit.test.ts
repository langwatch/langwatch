import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApp } from "../../../app-layer/app";
import { createReplayRuntime } from "../replayPreset";

vi.mock("ioredis", () => ({
  default: class {
    disconnect() {}
  },
}));

vi.mock("../../../app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("../../../clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock(
  "../../../app-layer/evaluations/repositories/evaluation-run.clickhouse.repository",
  () => ({ EvaluationRunClickHouseRepository: class {} }),
);

vi.mock(
  "../../../app-layer/traces/repositories/trace-summary.clickhouse.repository",
  () => ({ TraceSummaryClickHouseRepository: class {} }),
);

vi.mock(
  "../../pipelines/evaluation-processing/projections/evaluationRun.store",
  () => ({ EvaluationRunStore: class {} }),
);

vi.mock(
  "../../pipelines/experiment-run-processing/projections/experimentRunState.store",
  () => ({ createExperimentRunStateFoldStore: vi.fn(() => ({})) }),
);

vi.mock(
  "../../pipelines/experiment-run-processing/repositories/experimentRunState.clickhouse.repository",
  () => ({ ExperimentRunStateRepositoryClickHouse: class {} }),
);

vi.mock(
  "../../pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository",
  () => ({ SimulationRunStateRepositoryClickHouse: class {} }),
);

vi.mock("../../pipelines/simulation-processing/schemas/constants", () => ({
  SIMULATION_PROJECTION_VERSIONS: { RUN_STATE: "v1" },
}));

vi.mock("../../pipelines/trace-processing/projections/traceSummary.store", () => ({
  TraceSummaryStore: class {},
}));

vi.mock("../../projections/repositoryFoldStore", () => ({
  RepositoryFoldStore: class {},
}));

vi.mock("../replayService", () => ({
  ReplayService: class {},
}));

const mockedGetApp = vi.mocked(getApp);

/** Minimal pipeline definition double for replay discovery. */
function pipelineDef(params: {
  name: string;
  aggregateType: string;
  mapProjectionNames: string[];
}) {
  return {
    metadata: { name: params.name, aggregateType: params.aggregateType },
    foldProjections: new Map(),
    mapProjections: new Map(
      params.mapProjectionNames.map((name) => [name, { definition: { name } }]),
    ),
    stateProjections: new Map(),
  };
}

function stubApp(definitions: unknown[]) {
  mockedGetApp.mockReturnValue({
    eventSourcing: { definitions },
    retentionPolicyCache: {},
  } as unknown as ReturnType<typeof getApp>);
}

describe("createReplayRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a log_processing pipeline definition with the canonicalLogStorage map projection", () => {
    describe("when the replay runtime is created", () => {
      it("registers the canonicalLogStorage map projection despite the pipeline having no fold store", async () => {
        stubApp([
          pipelineDef({
            name: "log_processing",
            aggregateType: "log_record",
            mapProjectionNames: ["canonicalLogStorage"],
          }),
        ]);

        const runtime = createReplayRuntime({ redisUrl: "redis://unit-test" });

        expect(runtime.mapProjections).toEqual([
          expect.objectContaining({
            projectionName: "canonicalLogStorage",
            pipelineName: "log_processing",
            kind: "map",
            targetTable: "log_records",
            pauseKey: "log_processing/handler/canonicalLogStorage",
          }),
        ]);
        await runtime.close();
      });
    });
  });

  describe("given a storeless pipeline outside the replayable allow-list", () => {
    describe("when the replay runtime is created", () => {
      it("does not register its map projections", async () => {
        stubApp([
          pipelineDef({
            name: "automation_processing",
            aggregateType: "automation",
            mapProjectionNames: ["automationSideEffect"],
          }),
        ]);

        const runtime = createReplayRuntime({ redisUrl: "redis://unit-test" });

        expect(runtime.mapProjections).toEqual([]);
        await runtime.close();
      });
    });
  });
});
