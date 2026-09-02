/**
 * How the bindings audit turns a flat list of grants into one row per person.
 *
 * The grouping was inline in `platform/app/src/pages/settings/role-bindings.tsx`
 * and untested; it is the whole reading of the page, so it is pinned here.
 *
 * Spec: specs/rbac/role-binding-audit.feature
 */

import { describe, expect, it } from "vitest";
import {
  bindingsInFilter,
  groupBindingsByPrincipal,
  type RoleBinding,
  roleBadgePalette,
  scopeLabel,
  scopePillText,
} from "../role-binding-principals";

function binding(overrides: Partial<RoleBinding> & { id: string }): RoleBinding {
  return {
    userId: null,
    userName: null,
    userEmail: null,
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "MEMBER",
    customRoleId: null,
    customRoleName: null,
    scopeType: "PROJECT",
    scopeId: "proj-1",
    scopeName: "Web App",
    memberUserIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("the role bindings audit", () => {
  describe("when several bindings belong to one person", () => {
    /** @scenario Every binding a principal holds reads as one row */
    it("collects them onto one principal", () => {
      const principals = groupBindingsByPrincipal([
        binding({ id: "b1", userId: "u1", userName: "Ada", scopeType: "ORGANIZATION" }),
        binding({ id: "b2", userId: "u1", userName: "Ada", scopeType: "TEAM" }),
        binding({ id: "b3", userId: "u2", userName: "Grace" }),
      ]);

      expect(principals).toHaveLength(2);
      expect(principals[0]?.userName).toBe("Ada");
      expect(principals[0]?.bindings.map((row) => row.id)).toEqual(["b1", "b2"]);
    });

    it("orders principals by the name the reader sees", () => {
      const principals = groupBindingsByPrincipal([
        binding({ id: "b1", userId: "u1", userName: "Zoe" }),
        binding({ id: "b2", groupId: "g1", groupName: "Engineering" }),
        binding({ id: "b3", userId: "u2", userEmail: "ada@example.com" }),
      ]);

      expect(principals.map((principal) => principal.key)).toEqual(["u2", "g1", "u1"]);
    });

    /** @scenario A binding with no principal still appears on the audit */
    it("keeps a binding that names neither a user nor a group", () => {
      const principals = groupBindingsByPrincipal([
        binding({ id: "b1", apiKeyId: "k1", apiKeyName: "CI" }),
      ]);

      expect(principals).toHaveLength(1);
      expect(principals[0]?.key).toBe("unknown");
    });
  });

  describe("when the reader narrows to one scope tier", () => {
    const rows = [
      binding({ id: "b1", userId: "u1", scopeType: "ORGANIZATION" }),
      binding({ id: "b2", userId: "u1", scopeType: "TEAM" }),
      binding({ id: "b3", userId: "u1", scopeType: "PROJECT" }),
    ];

    /** @scenario The scope filter narrows the audit to one tier */
    it.each(["ORGANIZATION", "TEAM", "PROJECT"] as const)("keeps only %s bindings", (tier) => {
      expect(bindingsInFilter(rows, tier).map((row) => row.scopeType)).toEqual([tier]);
    });

    it("keeps every binding when nothing is narrowed", () => {
      expect(bindingsInFilter(rows, "ALL")).toHaveLength(3);
    });
  });

  describe("when a binding is labelled", () => {
    it("gives a custom role its own palette", () => {
      expect(roleBadgePalette("ADMIN")).toBe("red");
      expect(roleBadgePalette("MEMBER")).toBe("blue");
      expect(roleBadgePalette("VIEWER")).toBe("gray");
      expect(roleBadgePalette("CUSTOM")).toBe("purple");
    });

    it("names the scope, falling back to a short id when it has no name", () => {
      expect(scopeLabel("ORGANIZATION")).toBe("Org");
      expect(scopePillText(binding({ id: "b1", scopeName: "Web App" }))).toBe("Project · Web App");
      expect(
        scopePillText(binding({ id: "b1", scopeName: null, scopeId: "proj_abcdefghijkl" })),
      ).toBe("Project · proj_abc…");
    });
  });
});
