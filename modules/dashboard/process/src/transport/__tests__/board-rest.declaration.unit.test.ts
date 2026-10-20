/**
 * The addresses, methods and permissions the Dashboards boards REST family publishes:
 * `/api/v1/projects/:projectId/analytics/boards`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { boardRest } from "../board.rest.ts";

describe("given the Dashboards boards REST family", () => {
  const declaration = boardRest.router();

  describe("when its routes are read", () => {
    /** @scenario "AC199l Split: the public API reads Dashboards boards apart from the Reports boards" */
    it("publishes a list, a read, a create and a delete, literally, each asking its permission", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        v1Twin: declaration.v1Twin,
        routes: declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      }).toEqual({
        namespace: "boards",
        addressing: "literal",
        v1Twin: false,
        routes: [
          [
            "get",
            "/api/v1/projects/:projectId/analytics/boards",
            "getApiV1ProjectsByProjectIdAnalyticsBoards",
            "analytics:view",
          ],
          [
            "get",
            "/api/v1/projects/:projectId/analytics/boards/:boardId",
            "getApiV1ProjectsByProjectIdAnalyticsBoardsByBoardId",
            "analytics:view",
          ],
          [
            "post",
            "/api/v1/projects/:projectId/analytics/boards",
            "postApiV1ProjectsByProjectIdAnalyticsBoards",
            "analytics:create",
          ],
          [
            "delete",
            "/api/v1/projects/:projectId/analytics/boards/:boardId",
            "deleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardId",
            "analytics:delete",
          ],
        ],
      });
    });
  });
});
