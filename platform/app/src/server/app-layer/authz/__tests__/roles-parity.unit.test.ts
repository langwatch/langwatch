import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  builtinRoleGrants,
  builtinRolePermissions,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";

/**
 * Snapshot of the pre-migration role bags. This fixture is intentionally
 * independent from packages/authz so a role-table change cannot make parity
 * tests agree with itself.
 */
const LEGACY_ROLE_GRANTS = {
  admin: [
    "project:view",
    "project:create",
    "project:update",
    "project:delete",
    "project:manage",
    "analytics:view",
    "analytics:manage",
    "cost:view",
    "traces:view",
    "traces:create",
    "traces:update",
    "traces:share",
    "annotations:view",
    "annotations:manage",
    "evaluations:view",
    "evaluations:manage",
    "langy:view",
    "langy:manage",
    "workflows:view",
    "workflows:manage",
    "experiments:view",
    "experiments:manage",
    "datasets:view",
    "datasets:manage",
    "triggers:view",
    "triggers:manage",
    "prompts:view",
    "prompts:manage",
    "scenarios:view",
    "scenarios:manage",
    "secrets:view",
    "secrets:manage",
    "agentCache:view",
    "agentCache:manage",
    "team:view",
    "team:manage",
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
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
    "gatewayCacheRules:create",
    "gatewayCacheRules:update",
    "gatewayCacheRules:delete",
    "gatewayCacheRules:manage",
  ],
  member: [
    "project:view",
    "project:create",
    "project:update",
    "analytics:view",
    "analytics:manage",
    "cost:view",
    "traces:view",
    "traces:create",
    "traces:update",
    "traces:share",
    "annotations:view",
    "annotations:manage",
    "evaluations:view",
    "evaluations:manage",
    "langy:view",
    "langy:create",
    "langy:update",
    "langy:delete",
    "workflows:view",
    "workflows:manage",
    "experiments:view",
    "experiments:manage",
    "datasets:view",
    "datasets:manage",
    "triggers:view",
    "triggers:manage",
    "prompts:view",
    "prompts:manage",
    "scenarios:view",
    "scenarios:manage",
    "secrets:view",
    "secrets:manage",
    "agentCache:view",
    "agentCache:manage",
    "team:view",
    "virtualKeys:view",
    "virtualKeys:create",
    "virtualKeys:update",
    "virtualKeys:rotate",
    "gatewayBudgets:view",
    "gatewayProviders:view",
    "routingPolicies:view",
    "gatewayGuardrails:view",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
  ],
  viewer: [
    "project:view",
    "analytics:view",
    "traces:view",
    "annotations:view",
    "evaluations:view",
    "datasets:view",
    "workflows:view",
    "experiments:view",
    "prompts:view",
    "scenarios:view",
    "secrets:view",
    "team:view",
    "virtualKeys:view",
    "gatewayBudgets:view",
    "gatewayProviders:view",
    "routingPolicies:view",
    "gatewayGuardrails:view",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
  ],
  "lite-member": [
    "project:view",
    "analytics:view",
    "traces:view",
    "annotations:view",
    "annotations:create",
    "annotations:update",
    "evaluations:view",
    "datasets:view",
    "workflows:view",
    "experiments:view",
    "prompts:view",
    "scenarios:view",
    "secrets:view",
    "team:view",
  ],
  "org-admin": [
    "organization:view",
    "organization:manage",
    "organization:delete",
    "langy:view",
    "langy:manage",
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
    "virtualKeys:manage",
    "virtualKeys:viewOtherPersonal",
    "webhookEndpoints:view",
    "webhookEndpoints:manage",
    "gatewaySpend:view",
    "gatewaySpend:manage",
    "governanceCost:view",
    "sso:view",
    "sso:manage",
  ],
  "org-member": ["organization:view", "aiTools:view"],
} as const;

const LEGACY_ROLE_KEYS = [
  "admin",
  "member",
  "viewer",
  "lite-member",
  "org-admin",
  "org-member",
] as const;

const legacyPermissionSatisfiedBy = (
  granted: ReadonlySet<string>,
  requested: string,
): boolean => {
  if (granted.has(requested)) return true;
  const separator = requested.lastIndexOf(":");
  if (separator === -1) return false;
  const action = requested.slice(separator + 1);
  if (
    ![
      "view",
      "create",
      "update",
      "delete",
      "rotate",
      "attach",
      "detach",
    ].includes(action)
  )
    return false;
  return granted.has(`${requested.slice(0, separator)}:manage`);
};

describe("canonical built-in role expectations", () => {
  for (const role of LEGACY_ROLE_KEYS) {
    it(`${role} preserves every legacy permission decision`, () => {
      const expected = new Set(LEGACY_ROLE_GRANTS[role]);
      const actual = builtinRolePermissions(role);
      const missingDirectGrants = [...expected].filter(
        (permission) => !actual.has(permission),
      );
      expect(missingDirectGrants).toEqual([]);

      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          legacyPermissionSatisfiedBy(expected, permission) !==
          builtinRoleGrants({ role, permission }),
      );
      expect(mismatches).toEqual([]);
    });
  }

  it("maps team role keys without a second role table", () => {
    expect(roleKeyForTeamRole("ADMIN")).toBe("admin");
    expect(roleKeyForTeamRole("MEMBER")).toBe("member");
    expect(roleKeyForTeamRole("VIEWER")).toBe("viewer");
    expect(roleKeyForTeamRole("CUSTOM")).toBe("viewer");
  });

  it("keeps hierarchy behavior in the canonical matcher", () => {
    const granted = new Set(["datasets:manage"]);
    expect(permissionSatisfiedBy({ granted, requested: "datasets:view" })).toBe(
      true,
    );
    expect(
      permissionSatisfiedBy({ granted, requested: "organization:manage" }),
    ).toBe(false);
  });

  it("keeps organization-only permissions behind the organization scope", () => {
    expect(
      bindingScopeCanGrantPermission({
        scopeType: "TEAM",
        permission: "governance:view",
      }),
    ).toBe(false);
    expect(
      bindingScopeCanGrantPermission({
        scopeType: "ORGANIZATION",
        permission: "governance:view",
      }),
    ).toBe(true);
  });

  it("publishes only registry permissions", () => {
    const published = [
      ...builtinRolePermissions("admin"),
      ...builtinRolePermissions("member"),
      ...builtinRolePermissions("viewer"),
    ];
    expect(
      published.every((permission) =>
        ALL_PERMISSIONS.some((known) => known === permission),
      ),
    ).toBe(true);
  });
});
