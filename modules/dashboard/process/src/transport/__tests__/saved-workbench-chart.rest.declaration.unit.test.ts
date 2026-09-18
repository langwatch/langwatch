/**
 * The addresses, methods, permissions and operation ids the saved-workbench-chart
 * REST family publishes at the addresses issue #6480 names.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { savedWorkbenchChartRest } from "../saved-workbench-chart.rest.ts";

describe("given the saved workbench chart REST family", () => {
  const declaration = savedWorkbenchChartRest.router();

  describe("when its routes are read", () => {
    it("publishes the seven chart endpoints at the addresses issue #6480 names", () => {
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
          "/api/v1/projects/:projectId/analytics/charts",
          "getApiV1ProjectsByProjectIdAnalyticsCharts",
          "analytics:view",
        ],
        [
          "post",
          "/api/v1/projects/:projectId/analytics/charts",
          "postApiV1ProjectsByProjectIdAnalyticsCharts",
          "analytics:create",
        ],
        [
          "get",
          "/api/v1/projects/:projectId/analytics/charts/:chartId",
          "getApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
          "analytics:view",
        ],
        [
          "patch",
          "/api/v1/projects/:projectId/analytics/charts/:chartId",
          "patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
          "analytics:update",
        ],
        [
          "delete",
          "/api/v1/projects/:projectId/analytics/charts/:chartId",
          "deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
          "analytics:delete",
        ],
        [
          "put",
          "/api/v1/projects/:projectId/analytics/charts/:chartId/placement",
          "putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement",
          "analytics:update",
        ],
        [
          "delete",
          "/api/v1/projects/:projectId/analytics/charts/:chartId/placement",
          "deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement",
          "analytics:update",
        ],
      ]);
    });

    it("asks for the caller's protections only where a definition is written", () => {
      expect(
        declaration.routes
          .filter((route) =>
            (route.middleware ?? []).some(
              (middleware) => middleware.name === "langWatchQLCallerProtections",
            ),
          )
          .map((route) => route.operation),
      ).toEqual([
        "postApiV1ProjectsByProjectIdAnalyticsCharts",
        "patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
      ]);
    });
  });
});
