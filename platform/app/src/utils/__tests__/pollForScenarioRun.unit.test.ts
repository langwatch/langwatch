/**
 * Unit tests for pollForScenarioRun utility.
 * @see specs/scenarios/scenario-failure-handler.feature "Polling Logic Improvements"
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type {
  BatchRunDataResult,
  ScenarioRunData,
} from "~/server/scenarios/scenario-event.types";
import { pollForScenarioRun } from "../pollForScenarioRun";

type FetchBatchRunData = (params: {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}) => Promise<BatchRunDataResult>;

const NOW = 1_700_000_000_000;

/**
 * A run as the server actually sends it. Built from the schema-derived type on
 * purpose: a fixture that only carries the fields the poll happens to read can
 * keep passing after the wire shape moves underneath it.
 */
function makeRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scenario_123",
    batchRunId: "batch_789",
    scenarioRunId: "run_123",
    status: ScenarioRunStatus.IN_PROGRESS,
    messages: [],
    timestamp: NOW,
    durationInMs: 0,
    ...overrides,
  };
}

function batchWith({ runs }: { runs: ScenarioRunData[] }): BatchRunDataResult {
  return { changed: true, lastUpdatedAt: NOW, runs };
}

describe("pollForScenarioRun", () => {
  const baseParams = {
    projectId: "proj_123",
    scenarioSetId: "set_456",
    batchRunId: "batch_789",
  };

  let fetchBatchRunData: Mock<FetchBatchRunData>;

  beforeEach(() => {
    fetchBatchRunData = vi.fn<FetchBatchRunData>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function pollOnce() {
    const resultPromise = pollForScenarioRun({
      fetchBatchRunData,
      params: baseParams,
    });
    // Advancing by 0 flushes the mock's promise: the poll's first fetch fires
    // before any timer, so without this the assertion runs before it settles.
    await vi.advanceTimersByTimeAsync(0);
    return resultPromise;
  }

  describe("given a run exists for the batch", () => {
    describe("when it is still in progress", () => {
      it("hands back its id so the caller can show progress", async () => {
        fetchBatchRunData.mockResolvedValue(
          batchWith({
            runs: [makeRun({ status: ScenarioRunStatus.IN_PROGRESS })],
          }),
        );

        expect(await pollOnce()).toEqual({
          success: true,
          scenarioRunId: "run_123",
        });
        // And stops polling: one run is all the caller needs.
        expect(fetchBatchRunData).toHaveBeenCalledTimes(1);
      });

      it("hands back its id once messages have started arriving", async () => {
        fetchBatchRunData.mockResolvedValue(
          batchWith({
            runs: [
              makeRun({
                status: ScenarioRunStatus.IN_PROGRESS,
                messages: [{ id: "msg_1", role: "user", content: "Hello" }],
              }),
            ],
          }),
        );

        expect(await pollOnce()).toEqual({
          success: true,
          scenarioRunId: "run_123",
        });
      });
    });

    describe("when it finished successfully", () => {
      it("hands back its id", async () => {
        fetchBatchRunData.mockResolvedValue(
          batchWith({ runs: [makeRun({ status: ScenarioRunStatus.SUCCESS })] }),
        );

        expect(await pollOnce()).toEqual({
          success: true,
          scenarioRunId: "run_123",
        });
      });
    });

    describe("when it executed and did not pass", () => {
      it("reports run_failed, not an execution error", async () => {
        // The judge reached a verdict, or the runner stopped it at its turn
        // budget — either way the run produced an outcome, which an execution
        // error never does. Telling the user execution errored would send them
        // to debug infrastructure that never broke.
        fetchBatchRunData.mockResolvedValue(
          batchWith({ runs: [makeRun({ status: ScenarioRunStatus.FAILED })] }),
        );

        const result = await pollOnce();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("run_failed");
          // And carries the run id so the caller can offer to open the results.
          expect(result.scenarioRunId).toBe("run_123");
        }
      });
    });

    describe("when it never produced an outcome", () => {
      it("reports run_error for a run that errored", async () => {
        fetchBatchRunData.mockResolvedValue(
          batchWith({ runs: [makeRun({ status: ScenarioRunStatus.ERROR })] }),
        );

        const result = await pollOnce();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("run_error");
          expect(result.scenarioRunId).toBe("run_123");
        }
      });

      it("reports run_error for a run cancelled before it finished", async () => {
        fetchBatchRunData.mockResolvedValue(
          batchWith({
            runs: [makeRun({ status: ScenarioRunStatus.CANCELLED })],
          }),
        );

        const result = await pollOnce();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("run_error");
          expect(result.scenarioRunId).toBe("run_123");
        }
      });
    });

    describe("when its status is one this build does not recognise", () => {
      it("hands the caller the run rather than claiming it errored", async () => {
        // tRPC does not runtime-validate its output, so a status added to the
        // server after this client shipped arrives here unclassified. Unknown
        // means unknown: it could be a new active state or a new failure state,
        // and we cannot tell which. Handing back the run lets the run page show
        // the truth; asserting "it errored" would be a claim we cannot back —
        // and a red toast on a healthy run is the bug this module was fixed for.
        fetchBatchRunData.mockResolvedValue(
          batchWith({
            runs: [
              makeRun({ status: "SOME_FUTURE_STATUS" as ScenarioRunStatus }),
            ],
          }),
        );

        expect(await pollOnce()).toEqual({
          success: true,
          scenarioRunId: "run_123",
        });
      });
    });
  });

  describe("given no run has appeared yet", () => {
    describe("when the polling budget runs out", () => {
      it("reports a timeout", async () => {
        fetchBatchRunData.mockResolvedValue(batchWith({ runs: [] }));

        const resultPromise = pollForScenarioRun({
          fetchBatchRunData,
          params: baseParams,
        });

        // 30 seconds of budget = 60 attempts at 500ms.
        for (let i = 0; i < 60; i++) {
          await vi.advanceTimersByTimeAsync(500);
        }

        const result = await resultPromise;

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("timeout");
        }
      });
    });
  });
});
