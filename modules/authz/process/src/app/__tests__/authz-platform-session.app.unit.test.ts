/**
 * @see specs/rbac/platform-operators.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createAuthzTestApp } from "./authz.fixture.ts";

const ORG_SCOPE = { type: "organization", id: "org_1" } as const;
const OPERATOR = { id: "user_operator" };

function appWhere({ isOperator }: { isOperator: boolean }) {
  const can = vi.fn(async ({ scope }: { scope: { type: string } }) =>
    scope.type === "platform" ? isOperator : false,
  );

  return createAuthzTestApp({
    permissions: {
      getScope: async () => ORG_SCOPE,
      effectivePermissions: async () => ["organization:view"],
      can,
    },
  });
}

describe("AuthzModule.effectivePermissionsFor", () => {
  describe("given the session's user holds the platform-operator grant", () => {
    /** @scenario A platform operator's session carries ops permissions */
    it("adds ops:view and ops:manage to the scope's permissions", async () => {
      const answer = await appWhere({ isOperator: true }).effectivePermissionsFor(
        { organizationId: "org_1" },
        OPERATOR,
      );

      expect(answer).toEqual({
        scope: ORG_SCOPE,
        permissions: ["organization:view", "ops:view", "ops:manage"],
      });
    });
  });

  describe("given the session's user holds no platform grant", () => {
    /** @scenario A platform operator's session carries ops permissions */
    it("adds nothing", async () => {
      const answer = await appWhere({ isOperator: false }).effectivePermissionsFor(
        { organizationId: "org_1" },
        OPERATOR,
      );

      expect(answer.permissions).toEqual(["organization:view"]);
    });
  });
});

describe("AuthzModule.effectivePermissionsFor on an aggregate project", () => {
  const AGGREGATE_SCOPE = {
    type: "project",
    id: "proj_aggregate",
    teamId: "team_1",
    organizationId: "org_1",
    kind: "aggregate",
  } as const;

  function aggregateAppFor({ organizationRole }: { organizationRole: "ADMIN" | "MEMBER" }) {
    return createAuthzTestApp({
      permissions: {
        getScope: async () => AGGREGATE_SCOPE,
        getDecision: async () => ({ permitted: true, organizationRole }),
        effectivePermissions: async () => ["traces:view"],
        can: async () => false,
      },
    });
  }

  describe("given the caller is not an organisation admin", () => {
    it("answers that they may do nothing there", async () => {
      const answer = await aggregateAppFor({ organizationRole: "MEMBER" }).effectivePermissionsFor(
        { projectId: AGGREGATE_SCOPE.id },
        OPERATOR,
      );

      expect(answer).toEqual({
        scope: { type: "project", id: AGGREGATE_SCOPE.id },
        permissions: [],
      });
    });
  });

  describe("given the caller is an organisation admin", () => {
    it("answers their permissions there", async () => {
      const answer = await aggregateAppFor({ organizationRole: "ADMIN" }).effectivePermissionsFor(
        { projectId: AGGREGATE_SCOPE.id },
        OPERATOR,
      );

      expect(answer.permissions).toEqual(["traces:view"]);
    });
  });
});
