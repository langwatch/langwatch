/**
 * `langwatch analytics-reports get` reads only the Reports API: a Dashboards dashboard's id there
 * is not found, with no second request. Spec: modules/dashboard/specs/dashboards-v2.feature (AC8c)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyticsReportsApiError,
  AnalyticsReportsApiService,
} from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

vi.mock(
  "@/client-sdk/services/analytics-reports/analytics-reports-api.service",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    AnalyticsReportsApiService: vi.fn(),
  }),
);
vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));
vi.mock("ora", () => ({
  default: () => ({ start: vi.fn().mockReturnThis(), succeed: vi.fn(), fail: vi.fn() }),
}));

import { getAnalyticsReportCommand } from "../get";

const report = {
  id: "dashboard_v1",
  name: "Costs",
  order: 0,
  graphs: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("getAnalyticsReportCommand()", () => {
  const reportsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AnalyticsReportsApiService).mockImplementation(function () {
      return { get: reportsGet } as unknown as AnalyticsReportsApiService;
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  /** @scenario "AC8c An agent reads a Dashboards board by its id" */
  it("answers with the report the Reports API holds", async () => {
    reportsGet.mockResolvedValue(report);

    const result = await getAnalyticsReportCommand("dashboard_v1");

    expect(result).toMatchObject({ data: { id: "dashboard_v1", name: "Costs" } });
  });

  /** @scenario "AC8c An agent reads a Dashboards board by its id" */
  it("fails on a Dashboards dashboard's id after one request to the Reports API", async () => {
    reportsGet.mockRejectedValue(
      new AnalyticsReportsApiError("Dashboard not found", "get", undefined, 404),
    );

    await expect(getAnalyticsReportCommand("dashboard_v2")).rejects.toThrow("process.exit(1)");
    expect(reportsGet.mock.calls).toEqual([["dashboard_v2"]]);
  });
});
