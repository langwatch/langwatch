/**
 * Which built-in role templates carry `virtualKeys:viewOtherPersonal`. A binding stores only its
 * role key, so the grant is read from the template at decision time.
 * Spec: specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import { describe, expect, it } from "vitest";

import { builtinRoleGrants, permissionsConferred, roleKeyForTeamRole } from "../roles.ts";

const PERMISSION = "virtualKeys:viewOtherPersonal";

describe("given the role templates read when a binding is checked", () => {
  describe("when the binding is an admin binding", () => {
    /** @scenario "Existing org admins hold virtualKeys:viewOtherPersonal from the role template, with no migration" */
    it("confers viewOtherPersonal at the organization and on the team admin template", () => {
      expect(
        permissionsConferred({ role: "ADMIN", scopeType: "ORGANIZATION", customPermissions: [] }),
      ).toContain(PERMISSION);
      expect(builtinRoleGrants({ role: roleKeyForTeamRole("ADMIN"), permission: PERMISSION })).toBe(
        true,
      );
      expect(builtinRoleGrants({ role: "org-admin", permission: PERMISSION })).toBe(true);
    });
  });

  describe("when the binding is a member binding", () => {
    /** @scenario "Org member roles do NOT gain virtualKeys:viewOtherPersonal" */
    it("confers viewOtherPersonal at neither the organization nor the team", () => {
      expect(
        permissionsConferred({ role: "MEMBER", scopeType: "ORGANIZATION", customPermissions: [] }),
      ).not.toContain(PERMISSION);
      expect(builtinRoleGrants({ role: "org-member", permission: PERMISSION })).toBe(false);
      expect(
        builtinRoleGrants({ role: roleKeyForTeamRole("MEMBER"), permission: PERMISSION }),
      ).toBe(false);
    });
  });
});
