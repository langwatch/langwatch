import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsApiError } from "@/client-sdk/services/analytics/analytics-api.service";

vi.mock("@/client-sdk/services/analytics/analytics-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AnalyticsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { AnalyticsApiService } from "@/client-sdk/services/analytics/analytics-api.service";
import { queryAnalyticsCommand } from "../query";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("queryAnalyticsCommand()", () => {
  let mockTimeseries: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeseries = vi.fn();
    vi.mocked(AnalyticsApiService).mockImplementation(function () { return ({
      timeseries: mockTimeseries,
    }) as unknown as AnalyticsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when data is returned", () => {
    it("calls timeseries with default parameters", async () => {
      mockTimeseries.mockResolvedValue({
        currentPeriod: [{ date: Date.now(), "metadata.trace_id": 42 }],
        previousPeriod: [],
      });

      await queryAnalyticsCommand({});

      expect(mockTimeseries).toHaveBeenCalledOnce();
    });
  });

  describe("when using a metric preset", () => {
    it("resolves the preset to metric and aggregation", async () => {
      mockTimeseries.mockResolvedValue({
        currentPeriod: [{ date: Date.now(), "performance.total_cost": 1.5 }],
        previousPeriod: [],
      });

      await queryAnalyticsCommand({ metric: "total-cost" });

      expect(mockTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({
          series: [
            expect.objectContaining({
              metric: "performance.total_cost",
              aggregation: "sum",
            }),
          ],
        }),
      );
    });

    it("maps the natural-language latency alias to average completion time", async () => {
      mockTimeseries.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

      await queryAnalyticsCommand({ metric: "latency" });

      expect(mockTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({
          series: [
            expect.objectContaining({
              metric: "performance.completion_time",
              aggregation: "avg",
            }),
          ],
        }),
      );
    });
  });

  describe("when a machine format is requested", () => {
    it("returns the timeseries labelled with the resolved series as the payload", async () => {
      const result = {
        currentPeriod: [{ date: 123, val: 1 }],
        previousPeriod: [],
      };
      mockTimeseries.mockResolvedValue(result);

      const commandResult = await queryAnalyticsCommand({});

      // The command no longer decides the format — it hands the payload to
      // the output port. The resolved metric/aggregation ride along so a
      // consumer can label the result without guessing from numeric keys.
      expect(commandResult?.data).toEqual({
        ...result,
        metric: "metadata.trace_id",
        aggregation: "cardinality",
      });
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockTimeseries.mockRejectedValue(
        new AnalyticsApiError("Network error", "query analytics"),
      );

      await expect(queryAnalyticsCommand({})).rejects.toThrow(ProcessExitError);
    });
  });
});
