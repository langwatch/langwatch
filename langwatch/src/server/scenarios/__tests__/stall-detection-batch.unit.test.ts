import { describe, it, expect, vi } from "vitest";
import { ScenarioEventType, ScenarioRunStatus } from "../scenario-event.enums";

// Mock langwatch tracer - hoisted before service import
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: ReturnType<typeof vi.fn> }) => unknown
    ) => fn({ setAttribute: vi.fn() }),
  }),
}));

// Mock logger - suppress output
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock repository - expose mock fns for per-test configuration
const mockGetRunStartedEvents = vi.fn();
const mockGetMessageEvents = vi.fn();
const mockGetRunFinishedEvents = vi.fn();

vi.mock("../scenario-event.repository", () => {
  return {
    ScenarioEventRepository: class {
      getRunStartedEventsByScenarioRunIds = mockGetRunStartedEvents;
      getLatestMessageSnapshotEventsByScenarioRunIds = mockGetMessageEvents;
      getLatestRunFinishedEventsByScenarioRunIds = mockGetRunFinishedEvents;
    },
  };
});

// Import AFTER mocks are declared
import { ScenarioEventService } from "../scenario-event.service";

const NOW = Date.now();

function minutesAgo(minutes: number): number {
  return NOW - minutes * 60 * 1000;
}

describe("getScenarioRunDataBatch()", () => {
  describe("given a batch with mixed stalled and active runs", () => {
    describe("when the service resolves the batch run data", () => {
      it("marks run A as SUCCESS, run B as STALLED, run C as IN_PROGRESS", async () => {
        const runIds = ["run-A", "run-B", "run-C"];
        const projectId = "test-project";

        // Run A: finished with SUCCESS 20 min ago
        // Run B: started 15 min ago, no finish -> beyond 10-min threshold -> STALLED
        // Run C: started 2 min ago, no finish -> within threshold -> IN_PROGRESS
        mockGetRunStartedEvents.mockResolvedValue(
          new Map([
            [
              "run-A",
              {
                type: ScenarioEventType.RUN_STARTED,
                timestamp: minutesAgo(20),
                batchRunId: "batch-1",
                scenarioId: "scenario-1",
                scenarioRunId: "run-A",
                metadata: {},
              },
            ],
            [
              "run-B",
              {
                type: ScenarioEventType.RUN_STARTED,
                timestamp: minutesAgo(15),
                batchRunId: "batch-1",
                scenarioId: "scenario-2",
                scenarioRunId: "run-B",
                metadata: {},
              },
            ],
            [
              "run-C",
              {
                type: ScenarioEventType.RUN_STARTED,
                timestamp: minutesAgo(2),
                batchRunId: "batch-1",
                scenarioId: "scenario-3",
                scenarioRunId: "run-C",
                metadata: {},
              },
            ],
          ])
        );

        mockGetMessageEvents.mockResolvedValue(new Map());

        mockGetRunFinishedEvents.mockResolvedValue(
          new Map([
            [
              "run-A",
              {
                type: ScenarioEventType.RUN_FINISHED,
                timestamp: minutesAgo(20),
                batchRunId: "batch-1",
                scenarioId: "scenario-1",
                scenarioRunId: "run-A",
                status: ScenarioRunStatus.SUCCESS,
                results: null,
              },
            ],
          ])
        );

        const service = new ScenarioEventService();
        const runs = await service.getScenarioRunDataBatch({
          projectId,
          scenarioRunIds: runIds,
        });

        const statusByRunId = new Map(
          runs.map((r) => [r.scenarioRunId, r.status])
        );

        expect(statusByRunId.get("run-A")).toBe(ScenarioRunStatus.SUCCESS);
        expect(statusByRunId.get("run-B")).toBe(ScenarioRunStatus.STALLED);
        expect(statusByRunId.get("run-C")).toBe(ScenarioRunStatus.IN_PROGRESS);
      });
    });
  });
});
