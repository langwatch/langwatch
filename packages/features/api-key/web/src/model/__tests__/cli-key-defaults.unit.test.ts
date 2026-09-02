/**
 * What a `langwatch login` key is preselected to be able to do.
 *
 * Two things are pinned here and the second is the one worth reading.
 *
 * THE SCOPE DEFAULTS are the widest access the caller holds, and they can never
 * offer a scope the approve endpoint would refuse, because they are derived from
 * the same bindings the mint checks against.
 *
 * THE PERMISSION DEFAULT CHANGED IN EXACTLY ONE WAY when this family moved, and
 * it is recorded rather than hidden. The ceiling now comes from
 * `@langwatch/authz-contract`'s built-in role bags instead of
 * `platform/app/src/server/api/rbac`'s, and the contract's `admin` bag lists
 * `langy:create`, `langy:update` and `langy:delete` explicitly where the legacy
 * bag left them to `langy:manage` and the hierarchy rule. The default list is
 * filtered by PLAIN set membership, so an organization admin's minted key now
 * carries those three strings alongside the `langy:manage` it already carried.
 * The key can do exactly what it could before — manage implies all three at the
 * engine — but the stored list is three entries longer, and that is a
 * difference somebody should be able to find.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */

import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";
import { builtinRolePermissions, permissionSatisfiedBy } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { defaultCliKeyScopes } from "../cli-key-scope-defaults";
import { getUserPermissionsAcrossScopes } from "../api-key-permissions";

const ORG = "org-1";

describe("given an organization admin", () => {
  describe("when the CLI key's scopes are preselected", () => {
    /** @scenario org admin defaults to organization scope */
    it("collapses to one organization chip rather than listing every team", () => {
      expect(
        defaultCliKeyScopes({
          organizationId: ORG,
          bindings: [{ scopeType: "ORGANIZATION", scopeId: ORG, role: "ADMIN" }],
          sharedTeamIds: ["team-1", "team-2"],
          personalProjectId: "proj-personal",
        }),
      ).toEqual([{ scopeType: "ORGANIZATION", scopeId: ORG }]);
    });

    /** @scenario org admin defaults to organization scope */
    it("does the same for a member or viewer binding at the organization", () => {
      // An org-wide binding of any role is org-wide access; narrowing it to the
      // personal project would hand the key less than the reader holds.
      for (const role of ["MEMBER", "VIEWER"]) {
        expect(
          defaultCliKeyScopes({
            organizationId: ORG,
            bindings: [{ scopeType: "ORGANIZATION", scopeId: ORG, role }],
            sharedTeamIds: ["team-1"],
            personalProjectId: "proj-personal",
          }),
        ).toEqual([{ scopeType: "ORGANIZATION", scopeId: ORG }]);
      }
    });
  });
});

describe("given a member of two shared teams", () => {
  describe("when the CLI key's scopes are preselected", () => {
    /** @scenario regular member defaults to their own teams plus personal workspace */
    it("offers the teams they are bound to, in the organization's order, plus their own workspace", () => {
      expect(
        defaultCliKeyScopes({
          organizationId: ORG,
          bindings: [
            { scopeType: "TEAM", scopeId: "team-2", role: "MEMBER" },
            { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
          ],
          sharedTeamIds: ["team-1", "team-2", "team-3"],
          personalProjectId: "proj-personal",
        }),
      ).toEqual([
        { scopeType: "TEAM", scopeId: "team-1" },
        { scopeType: "TEAM", scopeId: "team-2" },
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });

    /** @scenario approval with zero scopes selected is refused */
    it("offers nothing at all to somebody with no bindings and no personal workspace", () => {
      expect(
        defaultCliKeyScopes({
          organizationId: ORG,
          bindings: [],
          sharedTeamIds: ["team-1"],
          personalProjectId: null,
        }),
      ).toEqual([]);
    });
  });
});

describe("given the ceiling the default permission list is narrowed to", () => {
  const ceiling = (role: string) =>
    getUserPermissionsAcrossScopes({
      myBindings: [{ scopeType: "TEAM", scopeId: "team-1", role }],
      scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
      organizationId: ORG,
      orgProjects: [{ id: "proj-1", teamId: "team-1" }],
      isServiceKey: false,
    });

  const held = (role: string) => {
    const bag = new Set(ceiling(role));
    return defaultCliKeyPermissions().filter((permission) => bag.has(permission));
  };

  describe("when the caller is a team admin", () => {
    /** @scenario the organization-management permissions are off by default */
    it("never includes an organization-management permission", () => {
      expect(held("ADMIN").some((permission) => permission.startsWith("organization:"))).toBe(
        false,
      );
    });

    /**
     * THE RECORDED DIFFERENCE. Read this failing as "somebody changed the role
     * bag", not as "the test is stale".
     *
     * @scenario the offered permissions are the intersection of every selected scope
     */
    it("carries the three explicit langy write permissions the legacy bag left implicit", () => {
      const list = held("ADMIN");
      expect(list).toContain("langy:manage");
      // The legacy bag held only `langy:view` and `langy:manage`, so a plain
      // membership filter dropped these three. The contract's admin bag lists
      // them, so they now go out. Behaviourally identical — manage satisfies all
      // three — and the assertion below is what says so.
      for (const permission of ["langy:create", "langy:update", "langy:delete"]) {
        expect(list).toContain(permission);
        expect(
          permissionSatisfiedBy({
            granted: builtinRolePermissions("admin"),
            requested: permission,
          }),
        ).toBe(true);
      }
    });
  });

  describe("when the caller is a viewer", () => {
    /** @scenario the offered permissions are the intersection of every selected scope */
    it("gets no write permission at all", () => {
      expect(held("VIEWER").filter((permission) => !permission.endsWith(":view"))).toEqual([]);
    });
  });
});
