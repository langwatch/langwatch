import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as EvaluationsApiModule from "@/client-sdk/services/experiments/experiments-api.service";

vi.mock(
  "@/client-sdk/services/experiments/experiments-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<typeof EvaluationsApiModule>();
    return {
      ...actual,
      ExperimentsApiService: vi.fn(),
    };
  },
);

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: "",
  }),
}));

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { experimentListRunsCommand } from "../list-runs";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppress output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("experimentListRunsCommand()", () => {
  let mockListRuns: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRuns = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(
      function () { return ({
          listRuns: mockListRuns,
        }) as unknown as ExperimentsApiService; });
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given no --experiment flag", () => {
    describe("when invoked", () => {
      /** @scenario "Listing runs requires --experiment" */
      it("exits with non-zero code", async () => {
        await expect(experimentListRunsCommand({})).rejects.toBeInstanceOf(
          ProcessExitError,
        );
      });
    });
  });

  describe("given an experiment slug with runs", () => {
    describe("when format is json", () => {
      /** @scenario "JSON format on runs dumps the raw payload" */
      it("emits the raw payload as JSON", async () => {
        const payload = {
          experimentId: "exp_1",
          experimentSlug: "checkout-flow",
          runs: [
            {
              experimentId: "exp_1",
              runId: "run_1",
              workflowVersion: null,
              timestamps: { createdAt: 1, updatedAt: 2 },
              summary: { evaluations: {} },
            },
          ],
          pagination: {
            page: 1,
            pageSize: 50,
            totalHits: 1,
            hasMore: false,
          },
        };
        mockListRuns.mockResolvedValue(payload);

        await experimentListRunsCommand({
          experiment: "checkout-flow",
          format: "json",
        });

        expect(mockListRuns).toHaveBeenCalledWith({
          experimentSlug: "checkout-flow",
          pageSize: 50,
        });
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain('"runId": "run_1"');
      });
    });

    describe("when format is table", () => {
      /** @scenario "Listing runs prints a table for a known slug" */
      it("includes the run id in stdout", async () => {
        mockListRuns.mockResolvedValue({
          experimentId: "exp_1",
          experimentSlug: "checkout-flow",
          runs: [
            {
              experimentId: "exp_1",
              runId: "run_visible",
              workflowVersion: null,
              timestamps: {
                createdAt: Date.now() - 1000,
                updatedAt: Date.now(),
                finishedAt: Date.now(),
              },
              summary: { evaluations: {} },
            },
          ],
          pagination: {
            page: 1,
            pageSize: 50,
            totalHits: 1,
            hasMore: false,
          },
        });

        await experimentListRunsCommand({ experiment: "checkout-flow" });
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("run_visible");
      });
    });
  });
});
