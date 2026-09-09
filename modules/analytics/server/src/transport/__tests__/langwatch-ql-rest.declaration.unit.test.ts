/**
 * The addresses, methods, permissions and operation ids the two LangWatchQL REST
 * families publish: `/api/v1/query`, and the saved charts under `/api/v1/projects`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { queryRest } from "../query.rest.ts";
import { savedWorkbenchChartRest } from "../saved-workbench-chart.rest.ts";

describe("given the query REST family", () => {
  const declaration = queryRest.router();

  describe("when its addressing is read", () => {
    it("names its generation first, so a consumer learns one rule for where v1 lives", () => {
      expect({ namespace: declaration.namespace, addressing: declaration.addressing }).toEqual({
        namespace: "query",
        addressing: "v1-only",
      });
    });
  });

  describe("when its routes are read", () => {
    it("publishes the run and the schema endpoints, both behind analytics:view", () => {
      expect(
        declaration.routes.map((route) => ({
          method: route.method,
          path: route.path,
          operation: route.operation,
          permission: route.permission,
        })),
      ).toEqual([
        { method: "post", path: "/", operation: "postApiV1Query", permission: "analytics:view" },
        {
          method: "get",
          path: "/schema",
          operation: "getApiV1QuerySchema",
          permission: "analytics:view",
        },
      ]);
    });

    it("asks the process for the credential's own content protections on both", () => {
      expect(
        declaration.routes.map((route) =>
          (route.middleware ?? []).map((middleware) => middleware.name),
        ),
      ).toEqual([["langWatchQLCallerProtections"], ["langWatchQLCallerProtections"]]);
    });
  });
});

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
