import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuiteRunService } from "../suite-run.service";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// The random generators are stubbed so ids are assertable; the derivations are
// NOT — a test of "the same submit produces the same runs" is worthless against
// a fake that returns a constant.
vi.mock("~/server/scenarios/scenario.ids", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/scenarios/scenario.ids")>()),
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
    const queueSimulationRunCommand = vi.fn().mockResolvedValue(undefined);

    let service: SuiteRunService;

    beforeEach(() => {
      vi.clearAllMocks();
      service = new SuiteRunService(queueSimulationRunCommand);
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
        });

        // 2 scenarios * 2 targets * 3 repeats = 12
        expect(result.items).toHaveLength(12);
      });
    });

    describe("given an idempotency key", () => {
      const submit = () =>
        service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["scenario-1", "scenario-2"],
          scenarioNameMap: new Map(),
          activeTargets: [{ type: "http", referenceId: "target-1" }],
          repeatCount: 2,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "submit-once",
        });

      describe("when the same suite is submitted twice", () => {
        /** @scenario "Resubmitting a suite with the same key does not queue it twice" */
        it("asks for exactly the same runs both times", async () => {
          const first = await submit();
          const second = await submit();

          // Identical ids mean identical QueueRunCommands — same aggregateId,
          // same command idempotency key, same job id — so the event store
          // collapses the second submit instead of queueing a second set.
          expect(second.items.map((i) => i.scenarioRunId)).toEqual(
            first.items.map((i) => i.scenarioRunId),
          );
          expect(second.batchRunId).toBe(first.batchRunId);
        });

        it("still distinguishes the runs within one submit", async () => {
          const { items } = await submit();

          const ids = items.map((i) => i.scenarioRunId);
          expect(new Set(ids).size).toBe(ids.length);
        });
      });

      describe("when a different key is used", () => {
        /** @scenario "A different key runs the suite again" */
        it("asks for a different batch and different runs", async () => {
          const first = await submit();
          const other = await service.startRun({
            suiteId: "suite-1",
            projectId: "project-1",
            activeScenarioIds: ["scenario-1", "scenario-2"],
            scenarioNameMap: new Map(),
            activeTargets: [{ type: "http", referenceId: "target-1" }],
            repeatCount: 2,
            skippedArchived: { scenarios: [], targets: [] },
            idempotencyKey: "submit-again",
          });

          expect(other.batchRunId).not.toBe(first.batchRunId);
          expect(other.items.map((i) => i.scenarioRunId)).not.toEqual(
            first.items.map((i) => i.scenarioRunId),
          );
        });
      });
    });

    describe("given no idempotency key", () => {
      describe("when the same suite is submitted twice", () => {
        /** @scenario "Submitting without a key runs the suite again" */
        it("keeps minting fresh ids, so running twice on purpose still works", async () => {
          const run = () =>
            service.startRun({
              suiteId: "suite-1",
              projectId: "project-1",
              activeScenarioIds: ["scenario-1"],
              scenarioNameMap: new Map(),
              activeTargets: [{ type: "http", referenceId: "target-1" }],
              repeatCount: 1,
              skippedArchived: { scenarios: [], targets: [] },
            });

          await run();
          await run();

          // Both submits queued their own run — the generators are stubbed to
          // constants here, so what this pins is that the derived path was NOT
          // taken and the call still went out twice.
          expect(queueSimulationRunCommand).toHaveBeenCalledTimes(2);
        });
      });
    });
  });
});
