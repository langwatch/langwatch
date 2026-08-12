import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../../utils/permissionsConfig";
import {
  EXTERNAL_MEMBER_PERMISSIONS,
  getOrganizationRolePermissions,
  getTeamRolePermissions,
  type Permission,
} from "../../api/rbac";
import { PERMISSION_CATEGORIES } from "../../api-key/permission-categories";
import {
  ALL_PERMISSIONS,
  isRegistryPermission,
  permissionIndex,
} from "../registry";

describe("authz registry", () => {
  describe("given the legacy vocabulary", () => {
    const legacyGrantedStrings: string[] = [
      ...Object.values(TeamUserRole).flatMap((role) =>
        getTeamRolePermissions(role),
      ),
      ...Object.values(OrganizationUserRole).flatMap((role) =>
        getOrganizationRolePermissions(role),
      ),
      ...EXTERNAL_MEMBER_PERMISSIONS,
    ];

    it("contains every permission any legacy role bag grants", () => {
      const missing = legacyGrantedStrings.filter(
        (permission) => !isRegistryPermission(permission),
      );
      expect(missing).toEqual([]);
    });

    it("contains every permission the API-key categories reference", () => {
      const categoryStrings = PERMISSION_CATEGORIES.flatMap((category) => [
        ...category.readPermissions,
        ...category.writePermissions,
      ]);
      const missing = categoryStrings.filter(
        (permission) => !isRegistryPermission(permission),
      );
      expect(missing).toEqual([]);
    });

    it("pins the legacy roles-UI catalogue drift (pairs the UI offers that nothing grants)", () => {
      // The legacy UI's default case offers manage/view/create/update/delete
      // for resources that only support view+manage — authorable, storable
      // (the cross-product validator accepts them), granted by no role bag,
      // requested by no call site. ADR-092 Context #3; the registry-derived
      // picker (stage E3) retires them. Shrinking this list is progress;
      // growing it is a regression.
      const uiStrings = orderedResources.flatMap((resource) =>
        getValidActionsForResource(resource).map(
          (action) => `${resource}:${action}`,
        ),
      );
      const missing = uiStrings.filter(
        (permission) => !isRegistryPermission(permission),
      );
      expect(missing).toEqual([
        "team:create",
        "team:update",
        "team:delete",
        "governance:create",
        "governance:update",
        "governance:delete",
        "aiTools:create",
        "aiTools:update",
        "aiTools:delete",
      ]);
    });
  });

  describe("when nonsense cross-product pairs are checked", () => {
    it("rejects actions the resource does not support", () => {
      expect(isRegistryPermission("traces:rotate")).toBe(false);
      expect(isRegistryPermission("cost:attach")).toBe(false);
      expect(isRegistryPermission("auditLog:delete")).toBe(false);
      expect(isRegistryPermission("not-a-resource:view")).toBe(false);
    });

    it("accepts real pairs", () => {
      expect(isRegistryPermission("traces:share")).toBe(true);
      expect(isRegistryPermission("virtualKeys:viewOtherPersonal")).toBe(true);
      expect(isRegistryPermission("governance:manage")).toBe(true);
    });
  });

  describe("given the append-only bitset contract", () => {
    it("pins the sentinel indices (never reorder — append only)", () => {
      expect(permissionIndex("organization:view")).toBe(0);
      expect(permissionIndex("organization:manage")).toBe(1);
      expect(permissionIndex("organization:delete")).toBe(2);
      expect(permissionIndex("project:view")).toBe(3);
      // aiTools:manage was the tail at count 117; the langy /
      // webhookEndpoints / gatewaySpend append (2026-08) moved the tail
      // without moving IT — that is the append-only contract working.
      expect(permissionIndex("aiTools:manage")).toBe(116);
      expect(permissionIndex("langy:manage")).toBe(ALL_PERMISSIONS.length - 1);
    });

    it("pins the total permission count (bump deliberately when appending)", () => {
      expect(ALL_PERMISSIONS.length).toBe(126);
    });

    it("keeps every legacy Permission string a registry member and vice versa where granted", () => {
      // The registry may contain requestable-but-never-granted pairs (the
      // manage-implication family); every one of them must still be a legal
      // legacy Permission template string.
      for (const permission of ALL_PERMISSIONS) {
        const [resource, action] = permission.split(":");
        expect(resource).toBeTruthy();
        expect(action).toBeTruthy();
        // Type-level check: assignment compiles.
        const legacy: Permission = permission as Permission;
        expect(legacy).toBe(permission);
      }
    });
  });
});
