import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationFacade } from "../simulation.facade";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { SimulationRunService } from "~/server/app-layer/simulations/simulation-run.service";
import type { ScenarioEventService } from "~/server/scenarios/scenario-event.service";

type MockProjectService = {
  isFeatureEnabled: ReturnType<typeof vi.fn>;
};

type MockChService = {
  [K in keyof SimulationRunService]: ReturnType<typeof vi.fn>;
};

type MockEsService = {
  getScenarioSetsDataForProject: ReturnType<typeof vi.fn>;
  getScenarioRunData: ReturnType<typeof vi.fn>;
  getBatchHistoryForScenarioSet: ReturnType<typeof vi.fn>;
  getRunDataForBatchRun: ReturnType<typeof vi.fn>;
  getRunDataForScenarioSet: ReturnType<typeof vi.fn>;
  getAllRunDataForScenarioSet: ReturnType<typeof vi.fn>;
  getScenarioRunDataByScenarioId: ReturnType<typeof vi.fn>;
  getBatchRunCountForScenarioSet: ReturnType<typeof vi.fn>;
  getExternalSetSummaries: ReturnType<typeof vi.fn>;
  getRunDataForAllSuites: ReturnType<typeof vi.fn>;
  saveScenarioEvent: ReturnType<typeof vi.fn>;
};

function makeMockChService(): MockChService {
  return {
    getScenarioSetsData: vi.fn().mockResolvedValue([{ id: "ch-set" }]),
    getScenarioRunData: vi.fn().mockResolvedValue({ id: "ch-run" }),
    getBatchHistoryForScenarioSet: vi.fn().mockResolvedValue({ batches: [], cursor: null }),
    getRunDataForBatchRun: vi.fn().mockResolvedValue({ changed: true, runs: [] }),
    getRunDataForScenarioSet: vi.fn().mockResolvedValue({ runs: [], cursor: null }),
    getAllRunDataForScenarioSet: vi.fn().mockResolvedValue([]),
    getScenarioRunDataByScenarioId: vi.fn().mockResolvedValue([]),
    getBatchRunCountForScenarioSet: vi.fn().mockResolvedValue(5),
    getExternalSetSummaries: vi.fn().mockResolvedValue([]),
    getRunDataForAllSuites: vi.fn().mockResolvedValue({ runs: [], cursor: null }),
    repository: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  } as unknown as MockChService;
}

function makeMockEsService(): MockEsService {
  return {
    getScenarioSetsDataForProject: vi.fn().mockResolvedValue([{ id: "es-set" }]),
    getScenarioRunData: vi.fn().mockResolvedValue({ id: "es-run" }),
    getBatchHistoryForScenarioSet: vi.fn().mockResolvedValue({ batches: [], cursor: null }),
    getRunDataForBatchRun: vi.fn().mockResolvedValue({ changed: true, runs: [] }),
    getRunDataForScenarioSet: vi.fn().mockResolvedValue({ runs: [], cursor: null }),
    getAllRunDataForScenarioSet: vi.fn().mockResolvedValue([]),
    getScenarioRunDataByScenarioId: vi.fn().mockResolvedValue([]),
    getBatchRunCountForScenarioSet: vi.fn().mockResolvedValue(3),
    getExternalSetSummaries: vi.fn().mockResolvedValue([]),
    getRunDataForAllSuites: vi.fn().mockResolvedValue({ runs: [], cursor: null }),
    saveScenarioEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SimulationFacade", () => {
  const projectId = "proj_test";

  describe("given ClickHouse service is available", () => {
    let facade: SimulationFacade;
    let mockProjects: MockProjectService;
    let mockCh: MockChService;
    let mockEs: MockEsService;

    beforeEach(() => {
      mockProjects = { isFeatureEnabled: vi.fn() };
      mockCh = makeMockChService();
      mockEs = makeMockEsService();
      facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: mockCh as unknown as SimulationRunService,
        esService: mockEs as unknown as ScenarioEventService,
      });
    });

    describe("when feature flag is enabled", () => {
      beforeEach(() => {
        mockProjects.isFeatureEnabled.mockResolvedValue(true);
      });

      it("routes getScenarioSetsDataForProject to ClickHouse", async () => {
        const result = await facade.getScenarioSetsDataForProject({ projectId });

        expect(result).toEqual([{ id: "ch-set" }]);
        expect(mockCh.getScenarioSetsData).toHaveBeenCalledWith({ projectId });
        expect(mockEs.getScenarioSetsDataForProject).not.toHaveBeenCalled();
      });

      it("routes getScenarioRunData to ClickHouse", async () => {
        await facade.getScenarioRunData({ projectId, scenarioRunId: "run_1" });

        expect(mockCh.getScenarioRunData).toHaveBeenCalledWith({ projectId, scenarioRunId: "run_1" });
        expect(mockEs.getScenarioRunData).not.toHaveBeenCalled();
      });

      it("routes getBatchHistoryForScenarioSet to ClickHouse", async () => {
        await facade.getBatchHistoryForScenarioSet({ projectId, scenarioSetId: "set_1" });

        expect(mockCh.getBatchHistoryForScenarioSet).toHaveBeenCalled();
        expect(mockEs.getBatchHistoryForScenarioSet).not.toHaveBeenCalled();
      });
    });

    describe("when feature flag is disabled", () => {
      beforeEach(() => {
        mockProjects.isFeatureEnabled.mockResolvedValue(false);
      });

      it("routes getScenarioSetsDataForProject to Elasticsearch", async () => {
        const result = await facade.getScenarioSetsDataForProject({ projectId });

        expect(result).toEqual([{ id: "es-set" }]);
        expect(mockEs.getScenarioSetsDataForProject).toHaveBeenCalledWith({ projectId });
        expect(mockCh.getScenarioSetsData).not.toHaveBeenCalled();
      });

      it("routes getScenarioRunData to Elasticsearch", async () => {
        await facade.getScenarioRunData({ projectId, scenarioRunId: "run_1" });

        expect(mockEs.getScenarioRunData).toHaveBeenCalledWith({ projectId, scenarioRunId: "run_1" });
        expect(mockCh.getScenarioRunData).not.toHaveBeenCalled();
      });
    });
  });

  describe("given ClickHouse service is null", () => {
    let facade: SimulationFacade;
    let mockProjects: MockProjectService;
    let mockEs: MockEsService;

    beforeEach(() => {
      mockProjects = { isFeatureEnabled: vi.fn() };
      mockEs = makeMockEsService();
      facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: null,
        esService: mockEs as unknown as ScenarioEventService,
      });
    });

    it("routes to Elasticsearch without checking the feature flag", async () => {
      await facade.getScenarioSetsDataForProject({ projectId });

      expect(mockEs.getScenarioSetsDataForProject).toHaveBeenCalledWith({ projectId });
      expect(mockProjects.isFeatureEnabled).not.toHaveBeenCalled();
    });

    it("routes all read methods to Elasticsearch", async () => {
      await facade.getRunDataForBatchRun({
        projectId,
        scenarioSetId: "set_1",
        batchRunId: "batch_1",
      });

      expect(mockEs.getRunDataForBatchRun).toHaveBeenCalled();
    });
  });

  describe("isClickHouseReadEnabled()", () => {
    it("returns true when chService is present and feature flag is enabled", async () => {
      const mockProjects: MockProjectService = { isFeatureEnabled: vi.fn().mockResolvedValue(true) };
      const facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: makeMockChService() as unknown as SimulationRunService,
        esService: makeMockEsService() as unknown as ScenarioEventService,
      });

      const result = await facade.isClickHouseReadEnabled(projectId);

      expect(result).toBe(true);
    });

    it("returns false when chService is null", async () => {
      const mockProjects: MockProjectService = { isFeatureEnabled: vi.fn().mockResolvedValue(true) };
      const facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: null,
        esService: makeMockEsService() as unknown as ScenarioEventService,
      });

      const result = await facade.isClickHouseReadEnabled(projectId);

      expect(result).toBe(false);
    });

    it("returns false when feature flag is disabled", async () => {
      const mockProjects: MockProjectService = { isFeatureEnabled: vi.fn().mockResolvedValue(false) };
      const facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: makeMockChService() as unknown as SimulationRunService,
        esService: makeMockEsService() as unknown as ScenarioEventService,
      });

      const result = await facade.isClickHouseReadEnabled(projectId);

      expect(result).toBe(false);
    });
  });

  describe("saveScenarioEvent", () => {
    it("always delegates to Elasticsearch regardless of flag", async () => {
      const mockProjects: MockProjectService = {
        isFeatureEnabled: vi.fn().mockResolvedValue(true),
      };
      const mockCh = makeMockChService();
      const mockEs = makeMockEsService();

      const facade = new SimulationFacade({
        projects: mockProjects as unknown as ProjectService,
        chService: mockCh as unknown as SimulationRunService,
        esService: mockEs as unknown as ScenarioEventService,
      });

      const event = { projectId, type: "test_event" } as unknown as Parameters<
        typeof facade.saveScenarioEvent
      >[0];

      await facade.saveScenarioEvent(event);

      expect(mockEs.saveScenarioEvent).toHaveBeenCalledWith(event);
    });
  });
});
