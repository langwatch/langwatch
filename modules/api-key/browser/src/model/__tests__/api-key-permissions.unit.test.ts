import {
  categorizablePermissions,
  categoryPermissions,
  PERMISSION_CATEGORIES,
} from "@langwatch/api-key-contract";
// Permission ceiling, binding derivation, row summaries. Moved from platform/app; injects
// getTeamRolePermissions to avoid testing authz-contract.
// Spec: specs/api-keys/scope-based-permissions.feature
import { describe, expect, it } from "vitest";

import {
  bindingsToPermissionMode,
  bindingsToScopes,
  bindingsToSelections,
  clampSelectionsToAvailability,
  permissionsSummary,
  scopeLabel,
} from "../api-key-permissions.ts";

describe("permissionsSummary()", () => {
  describe("when permissionMode is all", () => {
    /** @scenario permissionsSummary formats "All" for full-access keys */
    it("returns 'All'", () => {
      expect(
        permissionsSummary({
          permissionMode: "all",
          grantedCount: 0,
          totalCount: PERMISSION_CATEGORIES.length,
        }),
      ).toBe("All");
    });
  });

  describe("when permissionMode is restricted", () => {
    /** @scenario permissionsSummary counts granted categories for restricted keys */
    it("returns count of granted categories", () => {
      expect(
        permissionsSummary({
          permissionMode: "restricted",
          grantedCount: 3,
          totalCount: PERMISSION_CATEGORIES.length,
        }),
        // The denominator is the number of categories a key can be given,
        // read from the registry so it cannot drift as categories are added.
      ).toBe(`3 of ${PERMISSION_CATEGORIES.length} permissions`);
    });
  });
});

describe("scopeLabel()", () => {
  describe("when scopeType is PROJECT with name", () => {
    /** @scenario scopeLabel formats project scope correctly */
    it("returns 'Project: My Project'", () => {
      expect(scopeLabel({ scopeType: "PROJECT", scopeName: "My Project" })).toBe(
        "Project: My Project",
      );
    });
  });

  describe("when scopeType is ORGANIZATION", () => {
    /** @scenario scopeLabel formats organization scope correctly */
    it("returns 'Organization'", () => {
      expect(scopeLabel({ scopeType: "ORGANIZATION" })).toBe("Organization");
    });
  });

  describe("when scopeType is TEAM with name", () => {
    it("returns 'Team: Engineering'", () => {
      expect(scopeLabel({ scopeType: "TEAM", scopeName: "Engineering" })).toBe("Team: Engineering");
    });
  });

  describe("when scopeType is PROJECT without name", () => {
    it("returns 'Project'", () => {
      expect(scopeLabel({ scopeType: "PROJECT" })).toBe("Project");
    });
  });
});

describe("bindingsToScopes()", () => {
  describe("when given role bindings", () => {
    it("extracts scopeType and scopeId", () => {
      const result = bindingsToScopes([
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
        { scopeType: "PROJECT", scopeId: "proj-1" },
      ]);
      expect(result).toEqual([
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
        { scopeType: "PROJECT", scopeId: "proj-1" },
      ]);
    });
  });

  describe("when given empty array", () => {
    it("returns empty array", () => {
      expect(bindingsToScopes([])).toEqual([]);
    });
  });
});

describe("bindingsToPermissionMode()", () => {
  describe("when permissionMode is 'all'", () => {
    it("returns 'all'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "all",
          grants: [{ role: "ADMIN" }],
        }),
      ).toBe("all");
    });
  });

  describe("when permissionMode is 'restricted'", () => {
    it("returns 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "restricted",
          grants: [{ role: "CUSTOM" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'readonly' (legacy)", () => {
    it("maps to 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "readonly",
          grants: [{ role: "VIEWER" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'all' but single binding is CUSTOM", () => {
    it("returns 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "all",
          grants: [{ role: "CUSTOM" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'all' with multiple bindings including CUSTOM", () => {
    it("returns 'all' because it only checks single-binding case", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "all",
          grants: [{ role: "CUSTOM" }, { role: "ADMIN" }],
        }),
      ).toBe("all");
    });
  });
});

describe("bindingsToSelections()", () => {
  const fakeDeps = {
    permissionCategories: [
      { key: "traces", accessLevels: ["read", "write"] as readonly string[] },
      { key: "cost", accessLevels: ["read"] as readonly string[] },
      {
        key: "scenarios",
        accessLevels: ["read", "write"] as readonly string[],
      },
    ],
    selectionsFromPermissions: (perms: string[]) => {
      const sel: Record<string, string> = {};
      if (perms.includes("traces:view")) sel.traces = "read";
      if (perms.includes("traces:create")) sel.traces = "write";
      return sel;
    },
    getTeamRolePermissions: (role: string) => {
      if (role === "MEMBER") return ["traces:view", "scenarios:view"];
      if (role === "ADMIN")
        return ["traces:view", "traces:create", "scenarios:view", "scenarios:manage"];
      return [];
    },
  };

  describe("when permissionMode is 'readonly' (legacy)", () => {
    it("sets all categories to read", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "readonly",
          grants: [{ role: "VIEWER", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({
        traces: "read",
        cost: "read",
        scenarios: "read",
      });
    });
  });

  describe("when binding has no entries", () => {
    it("returns empty object", () => {
      const result = bindingsToSelections({ permissionMode: "restricted", grants: [] }, fakeDeps);
      expect(result).toEqual({});
    });
  });

  describe("when binding is CUSTOM with permissions", () => {
    it("delegates to selectionsFromPermissions", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "restricted",
          grants: [
            {
              role: "CUSTOM",
              customRoleId: "cr-1",
              customRolePermissions: ["traces:view", "traces:create"],
            },
          ],
        },
        fakeDeps,
      );
      expect(result).toEqual({ traces: "write" });
    });
  });

  describe("when binding is VIEWER", () => {
    it("sets all categories to read", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "restricted",
          grants: [{ role: "VIEWER", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({
        traces: "read",
        cost: "read",
        scenarios: "read",
      });
    });
  });

  describe("when binding is MEMBER", () => {
    it("delegates to getTeamRolePermissions then selectionsFromPermissions", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "restricted",
          grants: [{ role: "MEMBER", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({ traces: "read" });
    });
  });

  describe("when binding is ADMIN (fallthrough)", () => {
    it("grants write where available, read otherwise", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "all",
          grants: [{ role: "ADMIN", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({
        traces: "write",
        cost: "read",
        scenarios: "write",
      });
    });
  });
});

describe("clampSelectionsToAvailability()", () => {
  const tracesRead = categoryPermissions({ key: "traces", level: "read" });
  const tracesWrite = categoryPermissions({ key: "traces", level: "write" });

  describe("when the ceiling still covers the chosen level", () => {
    it("keeps the selection untouched", () => {
      const result = clampSelectionsToAvailability({
        selections: { traces: "write" },
        userPermissions: tracesWrite,
      });
      expect(result).toEqual({ traces: "write" });
    });
  });

  describe("when the ceiling shrank to read only", () => {
    /** @scenario Customized permissions follow the scopes that are selected */
    it("falls back to read instead of sending a refused write", () => {
      const result = clampSelectionsToAvailability({
        selections: { traces: "write" },
        userPermissions: tracesRead,
      });
      expect(result).toEqual({ traces: "read" });
    });
  });

  describe("when the ceiling no longer covers the category at all", () => {
    it("drops the selection to none", () => {
      expect(
        clampSelectionsToAvailability({
          selections: { traces: "write" },
          userPermissions: [],
        }),
      ).toEqual({ traces: "none" });
      expect(
        clampSelectionsToAvailability({
          selections: { traces: "read" },
          userPermissions: [],
        }),
      ).toEqual({ traces: "none" });
    });
  });

  describe("when a selection names a category that does not exist", () => {
    it("drops it rather than passing it through", () => {
      const result = clampSelectionsToAvailability({
        selections: { "not-a-category": "write" },
        userPermissions: categorizablePermissions(),
      });
      expect(result).toEqual({ "not-a-category": "none" });
    });
  });

  describe("when the caller holds everything", () => {
    it("leaves every category at the level it was set to", () => {
      const selections = Object.fromEntries(
        PERMISSION_CATEGORIES.map((category) => [
          category.key,
          category.accessLevels.includes("write") ? ("write" as const) : ("read" as const),
        ]),
      );
      expect(
        clampSelectionsToAvailability({
          selections,
          userPermissions: categorizablePermissions(),
        }),
      ).toEqual(selections);
    });
  });
});
