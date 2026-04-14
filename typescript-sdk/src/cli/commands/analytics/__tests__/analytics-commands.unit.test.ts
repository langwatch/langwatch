import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsApiError } from "@/client-sdk/services/analytics/analytics-api.service";

vi.mock("@/client-sdk/services/analytics/analytics-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client-sdk/services/analytics/analytics-api.service")>();
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

const noop = () => {};

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
    vi.mocked(AnalyticsApiService).mockImplementation(() => ({
      timeseries: mockTimeseries,
    }) as unknown as AnalyticsApiService);
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
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        currentPeriod: [{ date: 123, val: 1 }],
        previousPeriod: [],
      };
      mockTimeseries.mockResolvedValue(result);

      await queryAnalyticsCommand({ format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
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
