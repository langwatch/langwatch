import { describe, expect, it } from "vitest";
import {
  bindingsToPermissionMode,
  bindingsToScopes,
  bindingsToSelections,
  computeBindings,
  getUserPermissionsAtScope,
  permissionLabelToRole,
  permissionsSummary,
  roleToPermissionLabel,
  roleSummary,
  rolesAtOrBelow,
  scopeLabel,
  type PermissionMode,
} from "./utils";

describe("rolesAtOrBelow()", () => {
  describe("when given ADMIN", () => {
    it("returns Admin, Member, Viewer, None", () => {
      expect(rolesAtOrBelow("ADMIN")).toEqual([
        { label: "Admin", value: "ADMIN" },
        { label: "Member", value: "MEMBER" },
        { label: "Viewer", value: "VIEWER" },
        { label: "None", value: "NONE" },
      ]);
    });
  });

  describe("when given MEMBER", () => {
    it("returns Member, Viewer, None", () => {
      expect(rolesAtOrBelow("MEMBER")).toEqual([
        { label: "Member", value: "MEMBER" },
        { label: "Viewer", value: "VIEWER" },
        { label: "None", value: "NONE" },
      ]);
    });
  });

  describe("when given VIEWER", () => {
    it("returns Viewer, None", () => {
      expect(rolesAtOrBelow("VIEWER")).toEqual([
        { label: "Viewer", value: "VIEWER" },
        { label: "None", value: "NONE" },
      ]);
    });
  });

  describe("when given CUSTOM", () => {
    it("returns empty array", () => {
      expect(rolesAtOrBelow("CUSTOM")).toEqual([]);
    });
  });

  describe("when given unknown role", () => {
    it("returns empty array", () => {
      expect(rolesAtOrBelow("UNKNOWN")).toEqual([]);
    });
  });
});

describe("computeBindings()", () => {
  const bindings = [
    {
      id: "b1",
      role: "ADMIN",
      customRoleId: null,
      scopeType: "ORGANIZATION",
      scopeId: "org-1",
    },
    {
      id: "b2",
      role: "MEMBER",
      customRoleId: null,
      scopeType: "PROJECT",
      scopeId: "proj-1",
    },
  ];

  const customBinding = [
    {
      id: "b3",
      role: "CUSTOM",
      customRoleId: "cr-1",
      scopeType: "TEAM",
      scopeId: "team-1",
    },
  ];

  describe("when data is undefined", () => {
    it("returns empty array", () => {
      const result = computeBindings({
        data: undefined,
        permissionMode: "all",
        roleOverrides: {},
      });
      expect(result).toEqual([]);
    });
  });

  describe("when permissionMode is all", () => {
    it("passes through roles unchanged", () => {
      const result = computeBindings({
        data: bindings,
        permissionMode: "all",
        roleOverrides: {},
      });
      expect(result).toEqual([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
        },
        {
          role: "MEMBER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "proj-1",
        },
      ]);
    });

    it("preserves customRoleId for CUSTOM roles", () => {
      const result = computeBindings({
        data: customBinding,
        permissionMode: "all",
        roleOverrides: {},
      });
      expect(result[0]!.customRoleId).toBe("cr-1");
    });
  });

  describe("when permissionMode is readonly", () => {
    it("sets all roles to VIEWER", () => {
      const result = computeBindings({
        data: bindings,
        permissionMode: "readonly",
        roleOverrides: {},
      });
      expect(result.every((b) => b.role === "VIEWER")).toBe(true);
    });

    it("clears customRoleId", () => {
      const result = computeBindings({
        data: customBinding,
        permissionMode: "readonly",
        roleOverrides: {},
      });
      expect(result[0]!.customRoleId).toBeNull();
    });

    it("preserves scope information", () => {
      const result = computeBindings({
        data: bindings,
        permissionMode: "readonly",
        roleOverrides: {},
      });
      expect(result[0]).toMatchObject({
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
      });
    });
  });

  describe("when permissionMode is restricted", () => {
    describe("when no overrides are set", () => {
      it("keeps original roles", () => {
        const result = computeBindings({
          data: bindings,
          permissionMode: "restricted",
          roleOverrides: {},
        });
        expect(result[0]!.role).toBe("ADMIN");
      });
    });

    describe("when an override changes the role", () => {
      it("applies the overridden role", () => {
        const result = computeBindings({
          data: bindings,
          permissionMode: "restricted",
          roleOverrides: { b1: "VIEWER" },
        });
        expect(result[0]!.role).toBe("VIEWER");
      });

      it("clears customRoleId for overridden bindings", () => {
        const result = computeBindings({
          data: customBinding,
          permissionMode: "restricted",
          roleOverrides: { b3: "VIEWER" },
        });
        expect(result[0]!.customRoleId).toBeNull();
      });
    });

    describe("when override matches the original role", () => {
      it("keeps the original binding unchanged", () => {
        const result = computeBindings({
          data: bindings,
          permissionMode: "restricted",
          roleOverrides: { b1: "ADMIN" },
        });
        expect(result[0]!.role).toBe("ADMIN");
      });
    });
  });
});

describe("roleToPermissionLabel()", () => {
  describe("when given ADMIN", () => {
    it("returns Write", () => {
      expect(roleToPermissionLabel("ADMIN")).toBe("Write");
    });
  });

  describe("when given VIEWER", () => {
    it("returns Read", () => {
      expect(roleToPermissionLabel("VIEWER")).toBe("Read");
    });
  });

  describe("when given MEMBER", () => {
    it("returns Read", () => {
      expect(roleToPermissionLabel("MEMBER")).toBe("Read");
    });
  });

  describe("when given CUSTOM", () => {
    it("returns Read", () => {
      expect(roleToPermissionLabel("CUSTOM")).toBe("Read");
    });
  });
});

describe("permissionLabelToRole()", () => {
  describe("when given Write", () => {
    it("returns ADMIN", () => {
      expect(permissionLabelToRole("Write")).toBe("ADMIN");
    });
  });

  describe("when given Read", () => {
    it("returns VIEWER", () => {
      expect(permissionLabelToRole("Read")).toBe("VIEWER");
    });
  });
});

describe("roleSummary()", () => {
  describe("when bindings is empty", () => {
    it("returns 'No permissions'", () => {
      expect(roleSummary([])).toBe("No permissions");
    });
  });

  describe("when given a single VIEWER on TEAM", () => {
    it("returns 'Team'", () => {
      expect(
        roleSummary([{ role: "VIEWER", scopeType: "TEAM", scopeId: "t1" }]),
      ).toBe("Team");
    });
  });

  describe("when given a single ADMIN on PROJECT", () => {
    it("returns 'Project'", () => {
      expect(
        roleSummary([{ role: "ADMIN", scopeType: "PROJECT", scopeId: "p1" }]),
      ).toBe("Project");
    });
  });

  describe("when given mixed scopes", () => {
    it("formats as 'Organization, 2 Projects'", () => {
      expect(
        roleSummary([
          { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "o1" },
          { role: "VIEWER", scopeType: "PROJECT", scopeId: "p1" },
          { role: "VIEWER", scopeType: "PROJECT", scopeId: "p2" },
        ]),
      ).toBe("Organization, 2 Projects");
    });
  });

  describe("when given multiple team scopes", () => {
    it("groups them together", () => {
      expect(
        roleSummary([
          { role: "ADMIN", scopeType: "TEAM", scopeId: "t1" },
          { role: "ADMIN", scopeType: "TEAM", scopeId: "t2" },
        ]),
      ).toBe("2 Teams");
    });
  });
});

describe("permissionsSummary()", () => {
  describe("when permissionMode is all", () => {
    /** @scenario permissionsSummary formats "All" for full-access keys */
    it("returns 'All'", () => {
      expect(
        permissionsSummary({
          permissionMode: "all",
          grantedCount: 0,
          totalCount: 14,
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
          totalCount: 14,
        }),
      ).toBe("3 of 14 permissions");
    });
  });
});

describe("scopeLabel()", () => {
  describe("when scopeType is PROJECT with name", () => {
    /** @scenario scopeLabel formats project scope correctly */
    it("returns 'Project: My Project'", () => {
      expect(
        scopeLabel({ scopeType: "PROJECT", scopeName: "My Project" }),
      ).toBe("Project: My Project");
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
      expect(
        scopeLabel({ scopeType: "TEAM", scopeName: "Engineering" }),
      ).toBe("Team: Engineering");
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
          roleBindings: [{ role: "ADMIN" }],
        }),
      ).toBe("all");
    });
  });

  describe("when permissionMode is 'restricted'", () => {
    it("returns 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "restricted",
          roleBindings: [{ role: "CUSTOM" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'readonly' (legacy)", () => {
    it("maps to 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "readonly",
          roleBindings: [{ role: "VIEWER" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'all' but single binding is CUSTOM", () => {
    it("returns 'restricted'", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "all",
          roleBindings: [{ role: "CUSTOM" }],
        }),
      ).toBe("restricted");
    });
  });

  describe("when permissionMode is 'all' with multiple bindings including CUSTOM", () => {
    it("returns 'all' because it only checks single-binding case", () => {
      expect(
        bindingsToPermissionMode({
          permissionMode: "all",
          roleBindings: [{ role: "CUSTOM" }, { role: "ADMIN" }],
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
      { key: "scenarios", accessLevels: ["read", "write"] as readonly string[] },
    ],
    selectionsFromPermissions: (perms: string[]) => {
      const sel: Record<string, string> = {};
      if (perms.includes("traces:view")) sel.traces = "read";
      if (perms.includes("traces:create")) sel.traces = "write";
      return sel;
    },
    getTeamRolePermissions: (role: string) => {
      if (role === "MEMBER") return ["traces:view", "scenarios:view"];
      if (role === "ADMIN") return ["traces:view", "traces:create", "scenarios:view", "scenarios:manage"];
      return [];
    },
  };

  describe("when permissionMode is 'readonly' (legacy)", () => {
    it("sets all categories to read", () => {
      const result = bindingsToSelections(
        { permissionMode: "readonly", roleBindings: [{ role: "VIEWER", customRoleId: null, customRolePermissions: null }] },
        fakeDeps,
      );
      expect(result).toEqual({ traces: "read", cost: "read", scenarios: "read" });
    });
  });

  describe("when binding has no entries", () => {
    it("returns empty object", () => {
      const result = bindingsToSelections(
        { permissionMode: "restricted", roleBindings: [] },
        fakeDeps,
      );
      expect(result).toEqual({});
    });
  });

  describe("when binding is CUSTOM with permissions", () => {
    it("delegates to selectionsFromPermissions", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "restricted",
          roleBindings: [{
            role: "CUSTOM",
            customRoleId: "cr-1",
            customRolePermissions: ["traces:view", "traces:create"],
          }],
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
          roleBindings: [{ role: "VIEWER", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({ traces: "read", cost: "read", scenarios: "read" });
    });
  });

  describe("when binding is MEMBER", () => {
    it("delegates to getTeamRolePermissions then selectionsFromPermissions", () => {
      const result = bindingsToSelections(
        {
          permissionMode: "restricted",
          roleBindings: [{ role: "MEMBER", customRoleId: null, customRolePermissions: null }],
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
          roleBindings: [{ role: "ADMIN", customRoleId: null, customRolePermissions: null }],
        },
        fakeDeps,
      );
      expect(result).toEqual({ traces: "write", cost: "read", scenarios: "write" });
    });
  });
});

describe("getUserPermissionsAtScope()", () => {
  const mockGetPerms = (role: string) => {
    if (role === "ADMIN") return ["project:manage", "project:view"];
    if (role === "MEMBER") return ["project:view", "project:update"];
    return ["project:view"];
  };

  const orgProjects = [
    { id: "proj-1", teamId: "team-1" },
  ];

  describe("when isServiceKey is true", () => {
    it("returns ADMIN permissions regardless of bindings", () => {
      const result = getUserPermissionsAtScope({
        myBindings: undefined,
        scopeType: "PROJECT",
        scopeId: "proj-1",
        organizationId: "org-1",
        orgProjects,
        isServiceKey: true,
        getTeamRolePermissions: mockGetPerms,
      });
      expect(result).toEqual(["project:manage", "project:view"]);
    });
  });

  describe("when no bindings match the scope", () => {
    it("returns empty array", () => {
      const result = getUserPermissionsAtScope({
        myBindings: [{ scopeType: "PROJECT", scopeId: "other-proj", role: "ADMIN" }],
        scopeType: "PROJECT",
        scopeId: "proj-1",
        organizationId: "org-1",
        orgProjects,
        isServiceKey: false,
        getTeamRolePermissions: mockGetPerms,
      });
      expect(result).toEqual([]);
    });
  });

  describe("when bindings is undefined", () => {
    it("returns empty array", () => {
      const result = getUserPermissionsAtScope({
        myBindings: undefined,
        scopeType: "PROJECT",
        scopeId: "proj-1",
        organizationId: "org-1",
        orgProjects,
        isServiceKey: false,
        getTeamRolePermissions: mockGetPerms,
      });
      expect(result).toEqual([]);
    });
  });

  describe("when exact scope matches", () => {
    it("returns permissions for the matched role", () => {
      const result = getUserPermissionsAtScope({
        myBindings: [{ scopeType: "PROJECT", scopeId: "proj-1", role: "MEMBER" }],
        scopeType: "PROJECT",
        scopeId: "proj-1",
        organizationId: "org-1",
        orgProjects,
        isServiceKey: false,
        getTeamRolePermissions: mockGetPerms,
      });
      expect(result).toEqual(["project:view", "project:update"]);
    });
  });

  describe("when org-level binding covers a project scope", () => {
    it("falls back to the org binding", () => {
      const result = getUserPermissionsAtScope({
        myBindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }],
        scopeType: "PROJECT",
        scopeId: "proj-1",
        organizationId: "org-1",
        orgProjects,
        isServiceKey: false,
        getTeamRolePermissions: mockGetPerms,
      });
      expect(result).toEqual(["project:manage", "project:view"]);
    });
  });
});
