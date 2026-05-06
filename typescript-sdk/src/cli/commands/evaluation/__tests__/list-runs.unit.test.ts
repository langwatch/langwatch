import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "@/client-sdk/services/evaluations/evaluations-api.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/client-sdk/services/evaluations/evaluations-api.service")
      >();
    return {
      ...actual,
      EvaluationsApiService: vi.fn(),
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

import { EvaluationsApiService } from "@/client-sdk/services/evaluations/evaluations-api.service";
import { evaluationListRunsCommand } from "../list-runs";

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

describe("evaluationListRunsCommand()", () => {
  let mockListRuns: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRuns = vi.fn();
    vi.mocked(EvaluationsApiService).mockImplementation(
      () =>
        ({
          listRuns: mockListRuns,
        }) as unknown as EvaluationsApiService,
    );
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("given no --experiment flag", () => {
    describe("when invoked", () => {
      it("exits with non-zero code", async () => {
        await expect(evaluationListRunsCommand({})).rejects.toBeInstanceOf(
          ProcessExitError,
        );
      });
    });
  });

  describe("given an experiment slug with runs", () => {
    describe("when format is json", () => {
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

        await evaluationListRunsCommand({
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

        await evaluationListRunsCommand({ experiment: "checkout-flow" });
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("run_visible");
      });
    });
  });
});
