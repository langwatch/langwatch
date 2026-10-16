import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-boards.js", () => ({ getBoard: vi.fn() }));
vi.mock("../langwatch-api-dashboards.ts", () => ({ getDashboard: vi.fn() }));
vi.mock("../langwatch-api-projects.js", () => ({ getCurrentProject: vi.fn() }));

import { getBoard } from "../langwatch-api-boards.js";
import { getDashboard } from "../langwatch-api-dashboards.ts";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleGetDashboard } from "../tools/get-dashboard.js";

const notFound = () =>
  new LangWatchApiError("LangWatch API error 404: Dashboard not found", 404, "{}");

describe("handleGetDashboard()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProject).mockResolvedValue({ id: "proj_1" } as never);
  });

  describe("when the id is a Dashboards board the Reports API does not hold", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("returns the board", async () => {
      vi.mocked(getDashboard).mockRejectedValue(notFound());
      vi.mocked(getBoard).mockResolvedValue({
        id: "dashboard_v2",
        name: "Ops board",
        description: null,
        scope: "PROJECT",
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        platformUrl: "https://app.langwatch.ai/p/analytics/boards/dashboard_v2",
      });

      const result = await handleGetDashboard({ id: "dashboard_v2" });

      expect(getBoard).toHaveBeenCalledWith({ projectId: "proj_1", boardId: "dashboard_v2" });
      expect(result).toContain("# Ops board");
      expect(result).toContain("dashboard_v2");
    });
  });

  describe("when neither area holds the id", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("fails with the Reports not found error", async () => {
      const original = notFound();
      vi.mocked(getDashboard).mockRejectedValue(original);
      vi.mocked(getBoard).mockRejectedValue(notFound());

      await expect(handleGetDashboard({ id: "missing" })).rejects.toBe(original);
    });
  });

  describe("when the Reports API fails for another reason", () => {
    it("does not look for a board", async () => {
      vi.mocked(getDashboard).mockRejectedValue(new LangWatchApiError("boom", 500, "{}"));

      await expect(handleGetDashboard({ id: "x" })).rejects.toThrow("boom");
      expect(getBoard).not.toHaveBeenCalled();
    });
  });
});
