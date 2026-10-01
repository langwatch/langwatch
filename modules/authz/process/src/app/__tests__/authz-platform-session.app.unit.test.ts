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
