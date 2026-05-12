import { describe, it, expect, vi, beforeEach } from "vitest";
import { SuiteRunService } from "../suite-run.service";
import { NullSuiteRunReadRepository } from "../repositories/suite-run.repository";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/server/scenarios/scenario.ids", () => ({
  generateBatchRunId: () => "batch-run-123",
  generateScenarioRunId: () => "scenario-run-id-1",
}));

vi.mock("~/server/suites/suite-set-id", () => ({
  getSuiteSetId: (_suiteId: string) => "set-456",
}));

vi.mock("~/server/app-layer/tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

vi.mock("@langwatch/ksuid", () => ({
  generate: vi.fn().mockReturnValue({ toString: () => "scenario-run-id-1" }),
}));

describe("SuiteRunService", () => {
  describe("startRun()", () => {
    const startSuiteRunCommand = vi.fn().mockResolvedValue(undefined);
    const queueSimulationRunCommand = vi.fn().mockResolvedValue(undefined);

    let service: SuiteRunService;

    beforeEach(() => {
      vi.clearAllMocks();
      service = new SuiteRunService(
        new NullSuiteRunReadRepository(),
        startSuiteRunCommand,
        queueSimulationRunCommand,
      );
    });

    describe("when a run is started with one scenario and one target", () => {
      it("includes generated items in the result", async () => {
        const result = await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["scenario-1"],
          scenarioNameMap: new Map([["scenario-1", "My Scenario"]]),
          activeTargets: [{ type: "http", referenceId: "target-1" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-1",
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          scenarioId: "scenario-1",
          name: "My Scenario",
          target: { type: "http", referenceId: "target-1" },
        });
        expect(typeof result.items[0]?.scenarioRunId).toBe("string");
      });

      it("returns batchRunId and setId in the result", async () => {
        const result = await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["scenario-1"],
          scenarioNameMap: new Map(),
          activeTargets: [{ type: "http", referenceId: "target-1" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-1",
        });

        expect(result.batchRunId).toBe("batch-run-123");
        expect(result.setId).toBe("set-456");
      });
    });

    describe("when a run is started with multiple scenarios, targets and repeats", () => {
      it("returns items count equal to scenarios * targets * repeatCount", async () => {
        const result = await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["s1", "s2"],
          scenarioNameMap: new Map([
            ["s1", "Scenario 1"],
            ["s2", "Scenario 2"],
          ]),
          activeTargets: [
            { type: "http", referenceId: "t1" },
            { type: "http", referenceId: "t2" },
          ],
          repeatCount: 3,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-2",
        });

        // 2 scenarios * 2 targets * 3 repeats = 12
        expect(result.items).toHaveLength(12);
      });
    });
  });
});
