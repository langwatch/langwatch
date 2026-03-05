import { describe, it, expect, vi, beforeEach } from "vitest";

let mockEsInstance: MockService;

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: vi.fn().mockReturnValue({}),
}));

vi.mock("../clickhouse-simulation.service", () => ({
  ClickHouseSimulationService: {
    create: vi.fn(),
  },
}));

vi.mock("../../scenarios/scenario-event.service", () => {
  return {
    ScenarioEventService: class {
      constructor() {
        Object.assign(this, mockEsInstance);
      }
    },
  };
});

vi.mock("~/server/db", () => ({
  prisma: {},
}));

import { SimulationService } from "../simulation.service";
import { ClickHouseSimulationService } from "../clickhouse-simulation.service";

type MockService = Record<string, ReturnType<typeof vi.fn>>;

function createMockChService(): MockService {
  return {
    getScenarioSetsData: vi.fn().mockResolvedValue([]),
    getScenarioRunData: vi.fn().mockResolvedValue(null),
    getRunDataForBatchRun: vi.fn().mockResolvedValue([]),
    getBatchRunCountForScenarioSet: vi.fn().mockResolvedValue(5),
    getScenarioRunDataByScenarioId: vi.fn().mockResolvedValue([]),
    getAllRunDataForScenarioSet: vi.fn().mockResolvedValue([]),
    getRunDataForScenarioSet: vi
      .fn()
      .mockResolvedValue({ runs: [], nextCursor: undefined, hasMore: false }),
    getRunDataForAllSuites: vi.fn().mockResolvedValue({
      runs: [],
      scenarioSetIds: {},
      nextCursor: undefined,
      hasMore: false,
    }),
    softDeleteAllForProject: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockEsService(): MockService {
  return {
    getScenarioSetsDataForProject: vi.fn().mockResolvedValue([]),
    getScenarioRunData: vi.fn().mockResolvedValue(null),
    getRunDataForBatchRun: vi.fn().mockResolvedValue([]),
    getBatchRunCountForScenarioSet: vi.fn().mockResolvedValue(10),
    getScenarioRunDataByScenarioId: vi.fn().mockResolvedValue([]),
    getAllRunDataForScenarioSet: vi.fn().mockResolvedValue([]),
    getRunDataForScenarioSet: vi
      .fn()
      .mockResolvedValue({ runs: [], nextCursor: undefined, hasMore: false }),
    getRunDataForAllSuites: vi.fn().mockResolvedValue({
      runs: [],
      scenarioSetIds: {},
      nextCursor: undefined,
      hasMore: false,
    }),
    deleteAllEventsForProject: vi.fn().mockResolvedValue(undefined),
    saveScenarioEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPrisma(featureEnabled: boolean) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        featureClickHouseDataSourceSimulations: featureEnabled,
      }),
    },
  };
}

describe("SimulationService", () => {
  let chService: MockService;
  let esService: MockService;

  beforeEach(() => {
    chService = createMockChService();
    esService = createMockEsService();
    mockEsInstance = esService;

    (ClickHouseSimulationService.create as ReturnType<typeof vi.fn>).mockReturnValue(
      chService,
    );
  });

  const READ_METHODS = [
    {
      name: "getScenarioSetsDataForProject",
      params: { projectId: "proj-1" },
      chMethod: "getScenarioSetsData",
      esMethod: "getScenarioSetsDataForProject",
    },
    {
      name: "getScenarioRunData",
      params: { projectId: "proj-1", scenarioRunId: "run-1" },
      chMethod: "getScenarioRunData",
      esMethod: "getScenarioRunData",
    },
    {
      name: "getRunDataForBatchRun",
      params: {
        projectId: "proj-1",
        scenarioSetId: "set-1",
        batchRunId: "batch-1",
      },
      chMethod: "getRunDataForBatchRun",
      esMethod: "getRunDataForBatchRun",
    },
    {
      name: "getBatchRunCountForScenarioSet",
      params: { projectId: "proj-1", scenarioSetId: "set-1" },
      chMethod: "getBatchRunCountForScenarioSet",
      esMethod: "getBatchRunCountForScenarioSet",
    },
    {
      name: "getScenarioRunDataByScenarioId",
      params: { projectId: "proj-1", scenarioId: "scenario-1" },
      chMethod: "getScenarioRunDataByScenarioId",
      esMethod: "getScenarioRunDataByScenarioId",
    },
    {
      name: "getAllRunDataForScenarioSet",
      params: { projectId: "proj-1", scenarioSetId: "set-1" },
      chMethod: "getAllRunDataForScenarioSet",
      esMethod: "getAllRunDataForScenarioSet",
    },
    {
      name: "getRunDataForScenarioSet",
      params: { projectId: "proj-1", scenarioSetId: "set-1" },
      chMethod: "getRunDataForScenarioSet",
      esMethod: "getRunDataForScenarioSet",
    },
    {
      name: "getRunDataForAllSuites",
      params: { projectId: "proj-1" },
      chMethod: "getRunDataForAllSuites",
      esMethod: "getRunDataForAllSuites",
    },
  ] as const;

  describe("when ClickHouse feature flag is enabled", () => {
    let service: SimulationService;

    beforeEach(() => {
      const prisma = createMockPrisma(true);
      service = new SimulationService(prisma as never);
    });

    for (const { name, params, chMethod } of READ_METHODS) {
      it(`routes ${name} to ClickHouse`, async () => {
        await (service as never as Record<string, (p: unknown) => Promise<unknown>>)[
          name
        ]!(params);

        expect(chService[chMethod]).toHaveBeenCalled();
      });
    }
  });

  describe("when ClickHouse feature flag is disabled", () => {
    let service: SimulationService;

    beforeEach(() => {
      const prisma = createMockPrisma(false);
      service = new SimulationService(prisma as never);
    });

    for (const { name, params, esMethod } of READ_METHODS) {
      it(`routes ${name} to Elasticsearch`, async () => {
        await (service as never as Record<string, (p: unknown) => Promise<unknown>>)[
          name
        ]!(params);

        expect(esService[esMethod]).toHaveBeenCalled();
      });
    }
  });

  describe("when ClickHouse client is not available", () => {
    let service: SimulationService;

    beforeEach(() => {
      (ClickHouseSimulationService.create as ReturnType<typeof vi.fn>).mockReturnValue(
        null,
      );
      const prisma = createMockPrisma(true); // flag enabled but no client
      service = new SimulationService(prisma as never);
    });

    for (const { name, params, esMethod } of READ_METHODS) {
      it(`falls back ${name} to Elasticsearch`, async () => {
        await (service as never as Record<string, (p: unknown) => Promise<unknown>>)[
          name
        ]!(params);

        expect(esService[esMethod]).toHaveBeenCalled();
      });
    }
  });
});
