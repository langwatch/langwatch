import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { NullSuiteRunReadRepository } from "../repositories/suite-run.repository";
import { SuiteRunService } from "../suite-run.service";

vi.mock("@langwatch/observability", () => ({
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
          scenarioVersionMap: new Map([["scenario-1", 1]]),
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
          scenarioVersionMap: new Map(),
          activeTargets: [{ type: "http", referenceId: "target-1" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-1",
        });

        expect(result.batchRunId).toBe("batch-run-123");
        expect(result.setId).toBe(getSuiteSetId("suite-1"));
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
          scenarioVersionMap: new Map([
            ["s1", 2],
            ["s2", 7],
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

    describe("when a run is started with a note", () => {
      /** @scenario "Every run of a batch carries the note stamped at queue time" */
      it("stamps the note on every queued run of the batch", async () => {
        await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["s1", "s2", "s3"],
          scenarioNameMap: new Map(),
          scenarioVersionMap: new Map(),
          activeTargets: [
            { type: "http", referenceId: "t1" },
            { type: "http", referenceId: "t2" },
          ],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-note-1",
          note: "switched judge to the stricter rubric",
        });

        expect(queueSimulationRunCommand).toHaveBeenCalledTimes(6);
        for (const call of queueSimulationRunCommand.mock.calls) {
          expect(call[0].metadata.note).toBe("switched judge to the stricter rubric");
        }
      });

      it("removes the spaces around the note", async () => {
        await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["s1"],
          scenarioNameMap: new Map(),
          scenarioVersionMap: new Map(),
          activeTargets: [{ type: "http", referenceId: "t1" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-note-2",
          note: "  retry after the timeout fix  ",
        });

        expect(queueSimulationRunCommand.mock.calls[0]?.[0].metadata.note).toBe(
          "retry after the timeout fix",
        );
      });

      /** @scenario "A note of only spaces is dropped" */
      it("records the same metadata as a run with no note when the note is only spaces", async () => {
        const withOnlySpaces = await metadataOfFirstQueuedRun({
          idempotencyKey: "idem-note-3",
          note: "   ",
        });
        const withoutNote = await metadataOfFirstQueuedRun({
          idempotencyKey: "idem-note-4",
        });

        expect(withOnlySpaces).toEqual(withoutNote);
      });
    });

    describe("when a run is started with no note", () => {
      /** @scenario "A run queued without a note records metadata identical to before notes existed" */
      it("records no note key at all", async () => {
        const metadata = await metadataOfFirstQueuedRun({
          idempotencyKey: "idem-note-5",
        });

        expect(metadata).not.toHaveProperty("note");
        expect(metadata).toEqual({
          langwatch: {
            targetReferenceId: "t1",
            targetType: "http",
            scenarioVersion: 3,
          },
        });
      });
    });

    describe("the version stamp on queued runs", () => {
      /** @scenario "The version stamped is the version read when the batch was queued" */
      it("stamps each queued run with its own scenario's version from the queue-time read", async () => {
        await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["s1", "s2"],
          scenarioNameMap: new Map([
            ["s1", "First case"],
            ["s2", "Second case"],
          ]),
          scenarioVersionMap: new Map([
            ["s1", 3],
            ["s2", 7],
          ]),
          activeTargets: [{ type: "http", referenceId: "t1" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-version-1",
        });

        const byScenarioId = new Map(
          queueSimulationRunCommand.mock.calls.map((call) => [
            call[0].scenarioId,
            call[0].metadata.langwatch,
          ]),
        );
        expect(byScenarioId.get("s1")).toEqual({
          targetReferenceId: "t1",
          targetType: "http",
          scenarioVersion: 3,
        });
        expect(byScenarioId.get("s2")).toEqual({
          targetReferenceId: "t1",
          targetType: "http",
          scenarioVersion: 7,
        });
      });

      /** @scenario "A suite run records the kind of target as well as the target" */
      it("records the target and its kind in the reserved namespace", async () => {
        await service.startRun({
          suiteId: "suite-1",
          projectId: "project-1",
          activeScenarioIds: ["s1"],
          scenarioNameMap: new Map(),
          scenarioVersionMap: new Map([["s1", 1]]),
          activeTargets: [{ type: "prompt", referenceId: "prompt-9" }],
          repeatCount: 1,
          skippedArchived: { scenarios: [], targets: [] },
          idempotencyKey: "idem-version-2",
        });

        expect(queueSimulationRunCommand.mock.calls[0]?.[0].metadata.langwatch).toEqual({
          targetReferenceId: "prompt-9",
          targetType: "prompt",
          scenarioVersion: 1,
        });
      });
    });

    async function metadataOfFirstQueuedRun({
      idempotencyKey,
      note,
    }: {
      idempotencyKey: string;
      note?: string;
    }) {
      queueSimulationRunCommand.mockClear();
      await service.startRun({
        suiteId: "suite-1",
        projectId: "project-1",
        activeScenarioIds: ["s1"],
        scenarioNameMap: new Map(),
        scenarioVersionMap: new Map([["s1", 3]]),
        activeTargets: [{ type: "http", referenceId: "t1" }],
        repeatCount: 1,
        skippedArchived: { scenarios: [], targets: [] },
        idempotencyKey,
        note,
      });
      return queueSimulationRunCommand.mock.calls[0]?.[0].metadata;
    }
  });
});
