import { describe, expect, it } from "vitest";
import {
  computeBindings,
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
