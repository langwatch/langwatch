/**
 * The dashboards service's routes, verbs and bodies over /api/v1/dashboards, the analytics
 * reports service's over /api/v1/analytics/reports, and the client's names for them.
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199s, AC199w)
 */
import { describe, expect, it, vi } from "vitest";

import { LangWatch } from "@/client-sdk";
import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";
import type { LangwatchApiClient } from "@/internal/api/client";

import * as dashboardsModule from "../dashboards-api.service";
import { DashboardsApiService } from "../dashboards-api.service";

const ok = (data: unknown) => vi.fn(async () => ({ data, response: new Response(null) }));

describe("DashboardsApiService", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage Dashboards boards at /api/v1/dashboards" */
  it("calls each /api/v1/dashboards route with its verb, path and body", async () => {
    const client = {
      GET: ok({ data: [] }),
      POST: ok({ id: "b_1" }),
      PATCH: ok({ id: "b_1" }),
      DELETE: ok({ id: "b_1", name: "Usage" }),
    };
    const service = new DashboardsApiService({
      langwatchApiClient: client as unknown as LangwatchApiClient,
    });
    const widget = { name: "Traces", code: "export default () => null;", queries: [] };

    await service.list();
    await service.get("b_1");
    await service.create({ name: "Usage" });
    await service.update({ dashboardId: "b_1", description: null });
    await service.delete("b_1");
    await service.listWidgets("b_1");
    await service.createWidget({ dashboardId: "b_1", widget });
    await service.getWidget({ dashboardId: "b_1", widgetId: "w_1" });
    await service.updateWidget({ dashboardId: "b_1", widgetId: "w_1", changes: { name: "P95" } });
    await service.deleteWidget({ dashboardId: "b_1", widgetId: "w_1" });

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

  /** @scenario "AC200f Langy setting: the CLI, MCP and Python SDK read and set the origins a board leaves out" */
  it("sends excludedOrigins as [], a list or null, and leaves it out when not given", async () => {
    const client = { PATCH: ok({ id: "b_1" }) };
    const service = new DashboardsApiService({
      langwatchApiClient: client as unknown as LangwatchApiClient,
    });

    await service.update({ dashboardId: "b_1", excludedOrigins: [] });
    await service.update({ dashboardId: "b_1", excludedOrigins: ["langy"] });
    await service.update({ dashboardId: "b_1", excludedOrigins: null });
    await service.update({ dashboardId: "b_1", name: "Usage" });

    const calls = client.PATCH.mock.calls as unknown as [string, { body: unknown }][];
    expect(calls.map(([, init]) => init.body)).toEqual([
      { excludedOrigins: [] },
      { excludedOrigins: ["langy"] },
      { excludedOrigins: null },
      { name: "Usage" },
    ]);
  });
});

describe("AnalyticsReportsApiService", () => {
  /** @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports" */
  it("manages the Analytics Reports at /api/v1/analytics/reports", async () => {
    const client = {
      GET: ok({ data: [] }),
      POST: ok({ id: "d_1" }),
      PATCH: ok({ id: "d_1" }),
      DELETE: ok({ id: "d_1", name: "Costs" }),
    };
    const service = new AnalyticsReportsApiService({
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

describe("LangWatch client", () => {
  const client = new LangWatch({ apiKey: "sk-test", endpoint: "https://app.langwatch.test" });

  /** @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports" */
  it("names the Dashboards API dashboards and the Reports API analyticsReports", () => {
    expect([
      client.dashboards instanceof DashboardsApiService,
      client.analyticsReports instanceof AnalyticsReportsApiService,
    ]).toEqual([true, true]);
  });

  /** @scenario "AC199w Names: the SDKs call the Dashboards API dashboards and the Reports API analytics reports" */
  it("has no boards alias for the Dashboards API", () => {
    expect(["boards" in client, "BoardsApiService" in dashboardsModule]).toEqual([false, false]);
  });
});
