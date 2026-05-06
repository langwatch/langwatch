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
import { experimentListCommand } from "../list";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppress output during tests
};

describe("experimentListCommand()", () => {
  let mockListExperiments: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListExperiments = vi.fn();
    vi.mocked(EvaluationsApiService).mockImplementation(
      () =>
        ({
          listExperiments: mockListExperiments,
        }) as unknown as EvaluationsApiService,
    );
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  describe("given the project owns experiments", () => {
    describe("when format is json", () => {
      it("emits the raw payload", async () => {
        mockListExperiments.mockResolvedValue({
          experiments: [
            {
              id: "exp_1",
              slug: "checkout-flow",
              name: "Checkout Flow",
              type: "EVALUATIONS_V3",
              workflowId: null,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              runsCount: 3,
              lastRunAt: "2026-01-02T00:00:00Z",
            },
          ],
          pagination: {
            page: 1,
            pageSize: 50,
            totalHits: 1,
            hasMore: false,
          },
        });

        await experimentListCommand({ format: "json" });
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain('"slug": "checkout-flow"');
      });
    });

    describe("when format is table", () => {
      it("renders rows including the slug", async () => {
        mockListExperiments.mockResolvedValue({
          experiments: [
            {
              id: "exp_1",
              slug: "checkout-flow",
              name: "Checkout Flow",
              type: "EVALUATIONS_V3",
              workflowId: null,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              runsCount: 0,
              lastRunAt: null,
            },
          ],
          pagination: {
            page: 1,
            pageSize: 50,
            totalHits: 1,
            hasMore: false,
          },
        });

        await experimentListCommand({});
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("checkout-flow");
      });
    });
  });

  describe("given the project has no experiments", () => {
    describe("when called", () => {
      it("prints an empty-state message", async () => {
        mockListExperiments.mockResolvedValue({
          experiments: [],
          pagination: {
            page: 1,
            pageSize: 50,
            totalHits: 0,
            hasMore: false,
          },
        });
        await experimentListCommand({});
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed.toLowerCase()).toContain("no experiments");
      });
    });
  });
});
