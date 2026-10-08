import { ALL_PERMISSIONS } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import type { CollectedGrants } from "../authz.ts";
import { bindingGrants } from "../matchers.ts";
import {
  builtinRoleGrants,
  builtinRolePermissions,
  PROJECT_READER_PERMISSIONS,
  PROJECT_READER_ROLE_KEY,
} from "../roles.ts";

/**
 * ADR-175, invariant "read grants never escalate": a project-reader grant lets an aggregate
 * project read its members' traces and analytics and nothing else. The list is closed.
 */

const ORG = "org_acme";

function grants(overrides?: Partial<CollectedGrants>): CollectedGrants {
  return {
    principal: { type: "user", id: "user_ana" },
    organizationId: ORG,
    organizationRole: "ADMIN",
    isOrgMember: true,
    membershipDisabled: false,
    bindings: [],
    customRolePermissions: new Map(),
    ...overrides,
  };
}

describe("project-reader role", () => {
  describe("when the permission list is read", () => {
    it("is exactly traces:view and analytics:view", () => {
      expect([...builtinRolePermissions(PROJECT_READER_ROLE_KEY)].toSorted()).toEqual([
        "analytics:view",
        "traces:view",
      ]);
      expect([...PROJECT_READER_PERMISSIONS].toSorted()).toEqual(["analytics:view", "traces:view"]);
    });
  });

  describe("when a project-reader grant is asked for a permission", () => {
    /** @scenario "A project-reader grant never escalates" */
    it("allows traces view and analytics view", () => {
      for (const permission of ["traces:view", "analytics:view"]) {
        expect(builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission })).toBe(true);
      }
    });

    /** @scenario "A project-reader grant never escalates" */
    it("denies traces manage, project manage and prompts view", () => {
      for (const permission of ["traces:manage", "project:manage", "prompts:view"]) {
        expect(builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission })).toBe(false);
      }
    });

    it("denies every registry permission outside the closed list", () => {
      const allowed = ALL_PERMISSIONS.filter((permission) =>
        builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission }),
      );
      expect(allowed.toSorted()).toEqual(["analytics:view", "traces:view"]);
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
