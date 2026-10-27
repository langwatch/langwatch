/**
 * The addresses, methods and permissions the boards REST families publish: the Dashboards
 * boards at `/api/v1/dashboards` with their widgets, and the Reports boards under analytics.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { boardProjectRest } from "../board-project.rest.ts";
import { boardRest } from "../board.rest.ts";
import { dashboardRest } from "../dashboard.rest.ts";

const routesOf = (declaration: {
  routes: readonly { method: string; path: string; permission?: unknown }[];
}) => declaration.routes.map((route) => [route.method, route.path, route.permission]);

describe("given the /api/v1/dashboards family", () => {
  const declaration = boardRest.router();

  describe("when its routes are read", () => {
    /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
    it("serves the boards and their widgets in the dashboards namespace, each asking its permission", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        routes: routesOf(declaration),
      }).toEqual({
        namespace: "dashboards",
        addressing: "dated",
        routes: [
          ["get", "/", "analytics:view"],
          ["post", "/", "analytics:create"],
          ["get", "/:dashboardId", "analytics:view"],
          ["patch", "/:dashboardId", "analytics:update"],
          ["delete", "/:dashboardId", "analytics:delete"],
          ["get", "/:dashboardId/widgets", "analytics:view"],
          ["post", "/:dashboardId/widgets", "analytics:create"],
          ["get", "/:dashboardId/widgets/:widgetId", "analytics:view"],
          ["patch", "/:dashboardId/widgets/:widgetId", "analytics:update"],
          ["delete", "/:dashboardId/widgets/:widgetId", "analytics:delete"],
        ],
      });
    });

    /** @scenario "AC199q Split: /api/v1/dashboards is not there while Dashboards is off" */
    it("asks every route whether Dashboards is released for the key's project", () => {
      expect(
        declaration.routes.every((route) =>
          route.middleware?.some((context) => context.name === "boardsReleased"),
        ),
      ).toBe(true);
    });
  });
});

describe("given the Analytics Reports boards family", () => {
  const declaration = dashboardRest.router();

  /** @scenario "AC199r Split: the Reports boards answer at /api/v1/analytics/reports" */
  it("serves them under /api/v1/analytics/reports, in analytics' namespace for good", () => {
    expect({
      addressing: declaration.addressing,
      v1Twin: declaration.v1Twin,
      routes: routesOf(declaration),
      owners: declaration.routes.map((route) => route.sharedPath?.owner),
    }).toEqual({
      addressing: "literal",
      v1Twin: false,
      routes: [
        ["get", "/api/v1/analytics/reports", "analytics:view"],
        ["post", "/api/v1/analytics/reports", "analytics:create"],
        ["put", "/api/v1/analytics/reports/reorder", "analytics:update"],
        ["get", "/api/v1/analytics/reports/:reportId", "analytics:view"],
        ["patch", "/api/v1/analytics/reports/:reportId", "analytics:update"],
        ["delete", "/api/v1/analytics/reports/:reportId", "analytics:manage"],
      ],
      owners: Array(6).fill("analytics"),
    });
  });

  /** @scenario "AC199r Split: the Reports boards answer at /api/v1/analytics/reports" */
  it("is deprecated in favour of /api/v1/dashboards, and the project-path family is not", () => {
    expect([declaration.deprecated?.successor, boardProjectRest.router().deprecated]).toEqual([
      "/api/v1/dashboards",
      undefined,
    ]);
    expect(routesOf(boardProjectRest.router())).toEqual([
      ["get", "/api/v1/projects/:projectId/analytics/boards", "analytics:view"],
      ["get", "/api/v1/projects/:projectId/analytics/boards/:dashboardId", "analytics:view"],
    ]);
  });
});
