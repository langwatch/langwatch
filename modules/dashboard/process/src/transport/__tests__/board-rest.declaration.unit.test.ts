/**
 * The addresses, methods and permissions the Dashboards boards REST families publish:
 * `/api/v1/boards` with its widgets, and the read-only project-path family it supersedes.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { boardProjectRest } from "../board-project.rest.ts";
import { boardRest } from "../board.rest.ts";
import { dashboardRest } from "../dashboard.rest.ts";

const routesOf = (declaration: {
  routes: readonly { method: string; path: string; permission?: unknown }[];
}) => declaration.routes.map((route) => [route.method, route.path, route.permission]);

describe("given the /api/v1/boards family", () => {
  const declaration = boardRest.router();

  describe("when its routes are read", () => {
    /** @scenario "AC199p Split: a board's widgets are a sub-resource of the board" */
    it("serves the boards and their widgets in the boards namespace, each asking its permission", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        routes: routesOf(declaration),
      }).toEqual({
        namespace: "boards",
        addressing: "dated",
        routes: [
          ["get", "/", "analytics:view"],
          ["post", "/", "analytics:create"],
          ["get", "/:boardId", "analytics:view"],
          ["patch", "/:boardId", "analytics:update"],
          ["delete", "/:boardId", "analytics:delete"],
          ["get", "/:boardId/widgets", "analytics:view"],
          ["post", "/:boardId/widgets", "analytics:create"],
          ["get", "/:boardId/widgets/:widgetId", "analytics:view"],
          ["patch", "/:boardId/widgets/:widgetId", "analytics:update"],
          ["delete", "/:boardId/widgets/:widgetId", "analytics:delete"],
        ],
      });
    });

    /** @scenario "AC199q Split: /api/v1/boards is not there while Dashboards is off" */
    it("asks every route whether Dashboards is released for the key's project", () => {
      expect(
        declaration.routes.every((route) =>
          route.middleware?.some((context) => context.name === "boardsReleased"),
        ),
      ).toBe(true);
    });
  });
});

describe("given the routes /api/v1/boards supersedes", () => {
  /** @scenario "AC199r Split: the Reports boards API points to /api/v1/boards once Dashboards is on" */
  it("deprecates them for /api/v1/boards only where Dashboards is released", () => {
    expect(
      [dashboardRest.router(), boardProjectRest.router()].map(({ deprecated }) => ({
        successor: deprecated?.successor,
        when: deprecated?.when?.name,
      })),
    ).toEqual([
      { successor: "/api/v1/boards", when: "dashboardsReleased" },
      { successor: "/api/v1/boards", when: "dashboardsReleased" },
    ]);
  });

  /** @scenario "AC199r Split: the Reports boards API points to /api/v1/boards once Dashboards is on" */
  it("keeps the project-path family read-only", () => {
    expect(routesOf(boardProjectRest.router())).toEqual([
      ["get", "/api/v1/projects/:projectId/analytics/boards", "analytics:view"],
      ["get", "/api/v1/projects/:projectId/analytics/boards/:boardId", "analytics:view"],
    ]);
  });
});
