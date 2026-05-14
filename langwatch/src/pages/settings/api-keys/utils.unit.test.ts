import { describe, expect, it } from "vitest";
import {
  computeBindings,
  rolesAtOrBelow,
  type PermissionMode,
} from "./utils";

describe("rolesAtOrBelow", () => {
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

describe("computeBindings", () => {
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
        expect(result[1]!.role).toBe("MEMBER");
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
        expect(result[0]!.role).toBe("VIEWER");
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
        expect(result[0]!.customRoleId).toBeNull();
      });
    });
  });
});
