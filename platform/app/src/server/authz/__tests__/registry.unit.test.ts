import {
  ALL_PERMISSIONS,
  isRegistryPermission,
  permissionIndex,
} from "@langwatch/authz";
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

    it("pins the FULL serialization order (bitset indices ship inside signed passports — edit only by appending)", () => {
      // Point sentinels cannot catch a reorder between two pinned indices;
      // passports serialize bitset positions across process boundaries, so
      // the whole order is the contract. Append new permissions at the end
      // of this list in the same change that appends them to the registry.
      expect(ALL_PERMISSIONS).toEqual([
        "organization:view",
        "organization:manage",
        "organization:delete",
        "project:view",
        "project:create",
        "project:update",
        "project:delete",
        "project:manage",
        "team:view",
        "team:manage",
        "analytics:view",
        "analytics:create",
        "analytics:update",
        "analytics:delete",
        "analytics:manage",
        "cost:view",
        "traces:view",
        "traces:create",
        "traces:update",
        "traces:share",
        "scenarios:view",
        "scenarios:create",
        "scenarios:update",
        "scenarios:delete",
        "scenarios:manage",
        "annotations:view",
        "annotations:create",
        "annotations:update",
        "annotations:delete",
        "annotations:manage",
        "evaluations:view",
        "evaluations:create",
        "evaluations:update",
        "evaluations:delete",
        "evaluations:manage",
        "datasets:view",
        "datasets:create",
        "datasets:update",
        "datasets:delete",
        "datasets:manage",
        "triggers:view",
        "triggers:create",
        "triggers:update",
        "triggers:delete",
        "triggers:manage",
        "workflows:view",
        "workflows:create",
        "workflows:update",
        "workflows:delete",
        "workflows:manage",
        "experiments:view",
        "experiments:create",
        "experiments:update",
        "experiments:delete",
        "experiments:manage",
        "prompts:view",
        "prompts:create",
        "prompts:update",
        "prompts:delete",
        "prompts:manage",
        "secrets:view",
        "secrets:create",
        "secrets:update",
        "secrets:delete",
        "secrets:manage",
        "playground:view",
        "playground:create",
        "playground:update",
        "playground:delete",
        "playground:manage",
        "ops:view",
        "ops:manage",
        "auditLog:view",
        "virtualKeys:view",
        "virtualKeys:create",
        "virtualKeys:update",
        "virtualKeys:delete",
        "virtualKeys:rotate",
        "virtualKeys:manage",
        "virtualKeys:viewOtherPersonal",
        "gatewayBudgets:view",
        "gatewayBudgets:create",
        "gatewayBudgets:update",
        "gatewayBudgets:delete",
        "gatewayBudgets:manage",
        "gatewayProviders:view",
        "gatewayProviders:update",
        "gatewayProviders:manage",
        "routingPolicies:view",
        "routingPolicies:manage",
        "gatewayGuardrails:view",
        "gatewayGuardrails:attach",
        "gatewayGuardrails:detach",
        "gatewayGuardrails:manage",
        "gatewayLogs:view",
        "gatewayUsage:view",
        "gatewayCacheRules:view",
        "gatewayCacheRules:create",
        "gatewayCacheRules:update",
        "gatewayCacheRules:delete",
        "gatewayCacheRules:manage",
        "governance:view",
        "governance:manage",
        "ingestionSources:view",
        "ingestionSources:create",
        "ingestionSources:update",
        "ingestionSources:delete",
        "ingestionSources:manage",
        "anomalyRules:view",
        "anomalyRules:create",
        "anomalyRules:update",
        "anomalyRules:delete",
        "anomalyRules:manage",
        "complianceExport:view",
        "activityMonitor:view",
        "aiTools:view",
        "aiTools:manage",
        "webhookEndpoints:view",
        "webhookEndpoints:manage",
        "gatewaySpend:view",
        "gatewaySpend:manage",
        "langy:view",
        "langy:create",
        "langy:update",
        "langy:delete",
        "langy:manage",
      ]);
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
