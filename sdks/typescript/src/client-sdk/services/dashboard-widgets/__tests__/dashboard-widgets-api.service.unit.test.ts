/**
 * The dashboard widget service's board list: `dashboard-widget pin` resolves its target here.
 *
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199l)
 */
import { describe, expect, it, vi } from "vitest";

import type { LangwatchApiClient } from "@/internal/api/client";

import { DashboardWidgetsApiService } from "../dashboard-widgets-api.service";

const board = {
  id: "board_1",
  name: "Checkout health",
  description: null,
  scope: "PROJECT",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/acme/dashboards/board_1",
  widgetCount: 2,
};

describe("DashboardWidgetsApiService", () => {
  describe("when listing the boards a widget can be added to", () => {
    it("reads the Dashboards boards route of the project in scope, not /api/v1/dashboards", async () => {
      const GET = vi.fn(async () => ({ data: { data: [board] } }));
      const service = new DashboardWidgetsApiService({
        langwatchApiClient: { GET } as unknown as LangwatchApiClient,
        projectId: "project_1",
      });

      const { data } = await service.listBoards();

      expect(data).toEqual([board]);
      expect(GET).toHaveBeenCalledWith("/api/v1/projects/{projectId}/analytics/boards", {
        params: { path: { projectId: "project_1" } },
      });
    });
  });

  describe("getBoard()", () => {
    it("reads one board by its id on the project route", async () => {
      const GET = vi.fn().mockResolvedValue({ data: { id: "board_1" }, error: undefined });
      const service = new DashboardWidgetsApiService({
        langwatchApiClient: { GET } as never,
        projectId: "project_1",
      });

      await service.getBoard("board_1");

      expect(GET).toHaveBeenCalledWith("/api/v1/projects/{projectId}/analytics/boards/{boardId}", {
        params: { path: { projectId: "project_1", boardId: "board_1" } },
      });
    });
  });
});
