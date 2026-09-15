/**
 * @vitest-environment node
 * The two project-scoped families: their addresses, their door, the permission
 * each route asks and the facts each names.
 */
import { describe, expect, it } from "vitest";

import { codingAgentRest, codingAgentRollupRest } from "../coding-agent.rest.ts";

const sessions = codingAgentRest.router();
const rollup = codingAgentRollupRest.router();

describe("the coding-agent REST families", () => {
  describe("given the sessions family a process mounts", () => {
    it("keeps its namespace, its dated addressing and its /api/v1 twin", () => {
      expect(codingAgentRest.namespace).toBe("coding-agent");
      expect(sessions.addressing).toBe("dated");
      expect(sessions.v1Twin).toBe(true);
      expect(sessions.credential).toBe("project");
    });

    it("keeps the one path, its operation id and the permission it asks", () => {
      expect(
        sessions.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      ).toEqual([
        ["get", "/sessions/:sessionId/events", "listCodingAgentSessionEvents", "traces:view"],
      ]);
    });

    it("reads the project off the door rather than asking the caller to name one", () => {
      expect(sessions.routes[0]?.middleware).toBeUndefined();
    });
  });

  describe("given the rollup family a process mounts", () => {
    it("answers at the bare path alone, because the v1 address is another family's", () => {
      expect(codingAgentRollupRest.namespace).toBe("coding-agent-rollup");
      expect(rollup.addressing).toBe("literal");
      expect(rollup.v1Twin).toBe(false);
      expect(rollup.credential).toBe("project");
    });

    it("keeps the address, the operation id and the permission it asks", () => {
      expect(
        rollup.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
        ]),
      ).toEqual([
        [
          "get",
          "/api/coding-agent/pull-request-usage",
          "getCodingAgentPullRequestUsage",
          "traces:view",
        ],
      ]);
    });

    it("asks the door for the workspace and the credential the guard reads", () => {
      expect(rollup.routes[0]?.middleware?.map((fact) => fact.name)).toEqual([
        "codingAgentRestCaller",
      ]);
    });
  });
});
