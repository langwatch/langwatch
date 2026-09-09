/**
 * @vitest-environment node
 * The organization-keyed rollup: its one address, its door, and the fact it
 * asks the process for instead of a permission.
 */
import { describe, expect, it } from "vitest";

import { codingAgentV1Rest } from "../coding-agent-v1.rest.ts";

const declaration = codingAgentV1Rest.router();

describe("the coding-agent v1 REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("answers at the address it has always answered, with no twin to declare", () => {
      expect(codingAgentV1Rest.namespace).toBe("coding-agent-v1");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
    });

    it("opens the organization door, so no project id is sent anywhere", () => {
      expect(declaration.credential).toBe("organizationKey");
    });

    it("keeps the address and the operation id", () => {
      expect(
        declaration.routes.map((route) => [route.method, route.path, route.operation]),
      ).toEqual([
          [
            "get",
            "/api/v1/coding-agent/pull-request-usage",
            "getOrganizationCodingAgentPullRequestUsage",
          ],
        ],
      );
    });

    it("names no permission: the cut is the caller's own, resolved per project", () => {
      expect(declaration.routes[0]?.permission).toBeUndefined();
      expect(declaration.routes[0]?.access?.kind).toBe("authenticated");
    });

    it("asks the door for the key, the member it acts as, and the audit actor", () => {
      expect(declaration.routes[0]?.middleware?.map((fact) => fact.name)).toEqual([
        "codingAgentV1RestCaller",
      ]);
    });
  });
});
