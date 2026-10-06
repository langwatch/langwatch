import { describe, expect, it } from "vitest";

import { bindingGrants } from "../matchers";
import { ALL_PERMISSIONS } from "../registry";
import {
  PROJECT_READER_PERMISSIONS,
  PROJECT_READER_ROLE_KEY,
  builtinRoleGrants,
  builtinRolePermissions,
} from "../roles";
import type { CollectedGrants } from "../types";

/**
 * ADR-144, invariant "read grants never escalate": a project-reader grant
 * lets an aggregate project read its members' traces and analytics and
 * nothing else. The permission list is closed; every other registry
 * permission is denied through this role.
 */

const ORG = "org_acme";

function grants(overrides?: Partial<CollectedGrants>): CollectedGrants {
  return {
    principal: { type: "user", id: "user_ana" },
    organizationId: ORG,
    organizationRole: "ADMIN",
    membershipDisabled: false,
    bindings: [],
    customRolePermissions: new Map(),
    ...overrides,
  } as CollectedGrants;
}

describe("project-reader role", () => {
  describe("when the permission list is read", () => {
    it("is exactly traces:view and analytics:view", () => {
      expect([...builtinRolePermissions(PROJECT_READER_ROLE_KEY)].sort()).toEqual(
        ["analytics:view", "traces:view"],
      );
      expect([...PROJECT_READER_PERMISSIONS].sort()).toEqual([
        "analytics:view",
        "traces:view",
      ]);
    });
  });

  describe("when a project-reader grant is asked for a permission", () => {
    it("allows traces view and analytics view", () => {
      for (const permission of ["traces:view", "analytics:view"]) {
        expect(
          builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission }),
        ).toBe(true);
      }
    });

    it("denies traces manage, project manage and prompts view", () => {
      for (const permission of [
        "traces:manage",
        "project:manage",
        "prompts:view",
      ]) {
        expect(
          builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission }),
        ).toBe(false);
      }
    });

    it("denies every registry permission outside the closed list", () => {
      const allowed = ALL_PERMISSIONS.filter((permission) =>
        builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission }),
      );
      expect(allowed.sort()).toEqual(["analytics:view", "traces:view"]);
    });
  });

  describe("when the matcher meets a project-reader binding", () => {
    it("grants only on a PROJECT scope, whatever the organization role", () => {
      for (const organizationRole of ["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"] as const) {
        expect(
          bindingGrants({
            binding: { roleKey: "project-reader", scopeType: "PROJECT" },
            grants: grants({ organizationRole }),
            permission: "traces:view",
          }),
        ).toBe(true);
      }
      for (const scopeType of ["TEAM", "ORGANIZATION"] as const) {
        expect(
          bindingGrants({
            binding: { roleKey: "project-reader", scopeType },
            grants: grants(),
            permission: "traces:view",
          }),
        ).toBe(false);
      }
    });

    it("never escalates through the matcher either", () => {
      for (const permission of ["traces:manage", "project:manage", "prompts:view"]) {
        expect(
          bindingGrants({
            binding: { roleKey: "project-reader", scopeType: "PROJECT" },
            grants: grants(),
            permission,
          }),
        ).toBe(false);
      }
    });
  });
});
