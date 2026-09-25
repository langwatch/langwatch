/**
 * The addresses, methods and permissions the dashboard-widget REST family
 * publishes: `/api/v1/projects/:projectId/analytics/dashboard-widgets`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { dashboardWidgetRest } from "../dashboard-widget.rest.ts";

describe("given the dashboard widget REST family", () => {
  const declaration = dashboardWidgetRest.router();

  describe("when its addressing is read", () => {
    it("publishes its paths literally, with no /api/v1 twin of its own", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        v1Twin: declaration.v1Twin,
      }).toEqual({
        namespace: "dashboard-widgets",
        addressing: "literal",
        v1Twin: false,
      });
    });
  });

  describe("when its routes are read", () => {
    it("publishes the six widget endpoints at the addresses main serves", () => {
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      ).toEqual([
        [
          "get",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets",
          "getApiV1ProjectsByProjectIdAnalyticsDashboardWidgets",
          "analytics:view",
        ],
        [
          "post",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets",
          "postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets",
          "analytics:create",
        ],
        [
          "get",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
          "getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
          "analytics:view",
        ],
        [
          "patch",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
          "patchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
          "analytics:update",
        ],
        [
          "post",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard",
          "postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard",
          "analytics:update",
        ],
        [
          "delete",
          "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
          "deleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
          "analytics:delete",
        ],
      ]);
    });

    it("declares the create body's queries array in its input schema", () => {
      const create = declaration.routes.find(
        (route) => route.operation === "postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets",
      );

      expect(create?.input?.safeParse({ name: "widget", code: "x", queries: [] }).success).toBe(
        true,
      );
    });
  });
});
