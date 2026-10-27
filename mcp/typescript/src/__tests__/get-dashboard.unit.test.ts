import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-boards.js", () => ({ getDashboard: vi.fn() }));
vi.mock("../langwatch-api-dashboards.ts", () => ({ getAnalyticsReport: vi.fn() }));

import { getDashboard } from "../langwatch-api-boards.js";
import { getAnalyticsReport } from "../langwatch-api-dashboards.ts";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleGetDashboard } from "../tools/get-dashboard.js";

const notFound = () =>
  new LangWatchApiError("LangWatch API error 404: Dashboard not found", 404, "{}");

describe("handleGetDashboard()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the id is a Dashboards board the Reports API does not hold", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("returns the board", async () => {
      vi.mocked(getAnalyticsReport).mockRejectedValue(notFound());
      vi.mocked(getDashboard).mockResolvedValue({
        id: "dashboard_v2",
        name: "Ops board",
        description: null,
        scope: "PROJECT",
        createdById: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        platformUrl: "https://app.langwatch.ai/p/analytics/boards/dashboard_v2",
      });

      const result = await handleGetDashboard({ id: "dashboard_v2" });

      expect(getDashboard).toHaveBeenCalledWith({ dashboardId: "dashboard_v2" });
      expect(result).toContain("# Ops board");
      expect(result).toContain("dashboard_v2");
    });
  });

  describe("when neither area holds the id", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("fails with the Reports not found error", async () => {
      const original = notFound();
      vi.mocked(getAnalyticsReport).mockRejectedValue(original);
      vi.mocked(getDashboard).mockRejectedValue(notFound());

      await expect(handleGetDashboard({ id: "missing" })).rejects.toBe(original);
    });
  });

  describe("when the board route itself fails", () => {
    it("propagates that error rather than the Reports not found", async () => {
      vi.mocked(getAnalyticsReport).mockRejectedValue(notFound());
      const failure = new LangWatchApiError("boom", 500, "{}");
      vi.mocked(getDashboard).mockRejectedValue(failure);

      await expect(handleGetDashboard({ id: "x" })).rejects.toBe(failure);
    });
  });

  describe("when the Reports API fails for another reason", () => {
    it("does not look for a board", async () => {
      vi.mocked(getAnalyticsReport).mockRejectedValue(new LangWatchApiError("boom", 500, "{}"));

      await expect(handleGetDashboard({ id: "x" })).rejects.toThrow("boom");
      expect(getDashboard).not.toHaveBeenCalled();
    });
  });
});
