/**
 * The boards service's routes, verbs and bodies over /api/v1/dashboards, and the dashboards
 * service's over the Analytics Reports routes at /api/v1/analytics/reports.
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199s)
 */
import { describe, expect, it, vi } from "vitest";

import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import type { LangwatchApiClient } from "@/internal/api/client";

import { BoardsApiService } from "../boards-api.service";

const ok = (data: unknown) => vi.fn(async () => ({ data, response: new Response(null) }));

describe("BoardsApiService", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("calls each /api/v1/dashboards route with its verb, path and body", async () => {
    const client = {
      GET: ok({ data: [] }),
      POST: ok({ id: "b_1" }),
      PATCH: ok({ id: "b_1" }),
      DELETE: ok({ id: "b_1", name: "Usage" }),
    };
    const service = new BoardsApiService({
      langwatchApiClient: client as unknown as LangwatchApiClient,
    });
    const widget = { name: "Traces", code: "export default () => null;", queries: [] };

    await service.list();
    await service.get("b_1");
    await service.create({ name: "Usage" });
    await service.update({ boardId: "b_1", description: null });
    await service.delete("b_1");
    await service.listWidgets("b_1");
    await service.createWidget({ boardId: "b_1", widget });
    await service.getWidget({ boardId: "b_1", widgetId: "w_1" });
    await service.updateWidget({ boardId: "b_1", widgetId: "w_1", changes: { name: "P95" } });
    await service.deleteWidget({ boardId: "b_1", widgetId: "w_1" });

    const board = { params: { path: { dashboardId: "b_1" } } };
    const onBoard = { params: { path: { dashboardId: "b_1", widgetId: "w_1" } } };
    expect({
      GET: client.GET.mock.calls,
      POST: client.POST.mock.calls,
      PATCH: client.PATCH.mock.calls,
      DELETE: client.DELETE.mock.calls,
    }).toEqual({
      GET: [
        ["/api/v1/dashboards"],
        ["/api/v1/dashboards/{dashboardId}", board],
        ["/api/v1/dashboards/{dashboardId}/widgets", board],
        ["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}", onBoard],
      ],
      POST: [
        ["/api/v1/dashboards", { body: { name: "Usage" } }],
        ["/api/v1/dashboards/{dashboardId}/widgets", { ...board, body: widget }],
      ],
      PATCH: [
        ["/api/v1/dashboards/{dashboardId}", { ...board, body: { description: null } }],
        [
          "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
          { ...onBoard, body: { name: "P95" } },
        ],
      ],
      DELETE: [
        ["/api/v1/dashboards/{dashboardId}", board],
        ["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}", onBoard],
      ],
    });
  });
});

describe("DashboardsApiService", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("manages the Analytics Reports dashboards at /api/v1/analytics/reports", async () => {
    const client = {
      GET: ok({ data: [] }),
      POST: ok({ id: "d_1" }),
      PATCH: ok({ id: "d_1" }),
      DELETE: ok({ id: "d_1", name: "Costs" }),
    };
    const service = new DashboardsApiService({
      langwatchApiClient: client as unknown as LangwatchApiClient,
    });

    await service.list();
    await service.get("d_1");
    await service.create({ name: "Costs" });
    await service.rename("d_1", { name: "Spend" });
    await service.delete("d_1");

    const report = { params: { path: { reportId: "d_1" } } };
    expect({
      GET: client.GET.mock.calls,
      POST: client.POST.mock.calls,
      PATCH: client.PATCH.mock.calls,
      DELETE: client.DELETE.mock.calls,
    }).toEqual({
      GET: [["/api/v1/analytics/reports"], ["/api/v1/analytics/reports/{reportId}", report]],
      POST: [["/api/v1/analytics/reports", { body: { name: "Costs" } }]],
      PATCH: [["/api/v1/analytics/reports/{reportId}", { ...report, body: { name: "Spend" } }]],
      DELETE: [["/api/v1/analytics/reports/{reportId}", report]],
    });
  });
});
