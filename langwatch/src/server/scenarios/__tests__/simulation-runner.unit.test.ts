/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import ScenarioRunner from "@langwatch/scenario";
import { SimulationRunnerService } from "../simulation-runner.service";
import { ScenarioService } from "../scenario.service";

// Mock external dependencies
vi.mock("@langwatch/scenario", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/scenario")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      run: vi.fn(),
      userSimulatorAgent: vi.fn(() => ({ name: "UserSimulator" })),
      judgeAgent: vi.fn(() => ({ name: "JudgeAgent" })),
    },
  };
});

vi.mock("../../modelProviders/utils", () => ({
  getVercelAIModel: vi.fn(() => Promise.resolve({ modelId: "test-model" })),
}));

vi.mock("~/env.mjs", () => ({
  env: { BASE_HOST: "http://localhost:3000" },
}));

const mockScenarioRun = ScenarioRunner.run as Mock;
const mockJudgeAgent = ScenarioRunner.judgeAgent as Mock;

describe("SimulationRunnerService", () => {
  let service: SimulationRunnerService;
  let mockPrisma: {
    project: { findUnique: Mock };
  };
  let mockScenarioService: {
    getById: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          apiKey: "test-api-key",
          defaultModel: "openai/gpt-4o-mini",
        }),
      },
    };

    mockScenarioService = {
      getById: vi.fn(),
    };

    // Create service with mocked prisma
    service = SimulationRunnerService.create(mockPrisma as never);

    // Replace internal ScenarioService with mock
    vi.spyOn(ScenarioService, "create").mockReturnValue(
      mockScenarioService as unknown as ScenarioService
    );

    // Re-create service to use mocked ScenarioService
    service = SimulationRunnerService.create(mockPrisma as never);

    // Mock SDK run to succeed
    mockScenarioRun.mockResolvedValue({
      success: true,
      reasoning: "Test passed",
    });
  });

  describe("when executing a scenario", () => {
    it("loads scenario from ScenarioService", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test Scenario",
        situation: "User wants help",
        criteria: [],
      });

      await service.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
      });

      expect(mockScenarioService.getById).toHaveBeenCalledWith({
        projectId: "proj_123",
        id: "scen_123",
      });
    });

    it("passes situation as SDK description", async () => {
      const situation = "User is angry about billing";

      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Billing Complaint",
        situation,
        criteria: [],
      });

      await service.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
      });

      expect(mockScenarioRun).toHaveBeenCalledWith(
        expect.objectContaining({
          description: situation,
        })
      );
    });

    it("passes criteria to judge agent", async () => {
      const criteria = ["Must apologize", "Must offer refund"];

      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Refund Test",
        situation: "User wants refund",
        criteria,
      });

      await service.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
      });

      expect(mockJudgeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          criteria,
        })
      );
    });
  });

  describe("when scenario is not found", () => {
    it("does not invoke SDK", async () => {
      mockScenarioService.getById.mockResolvedValue(null);

      await service.execute({
        projectId: "proj_123",
        scenarioId: "scen_nonexistent",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
      });

      expect(mockScenarioRun).not.toHaveBeenCalled();
    });
  });
});

