/**
 * ADR-092 §1 — built-in roles declared as differences, not duplicate lists.
 * viewer is the base; member = viewer + additions; admin = member +
 * additions. The computed sets are parity-tested cell-for-cell against the
 * legacy bags in `server/api/rbac.ts` (roles-parity.unit.test.ts) — that
 * suite is the safety net the whole ADR-092 migration stands on.
 *
 * Client-safe: no Prisma, no env.
 */
import { type AuthzPermission, permissionSatisfiedBy } from "./registry";

export type BuiltinRoleKey =
  | "admin"
  | "member"
  | "viewer"
  | "lite-member"
  | "demo-viewer"
  | "org-admin"
  | "org-member";

const VIEWER: readonly AuthzPermission[] = [
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
];

const MEMBER_ADDITIONS: readonly AuthzPermission[] = [
  "project:create",
  "project:update",
  "analytics:manage",
  "cost:view",
  "traces:create",
  "traces:update",
  "traces:share",
  "annotations:manage",
  "evaluations:manage",
  "workflows:manage",
  "experiments:manage",
  "datasets:manage",
  "triggers:view",
  "triggers:manage",
  "prompts:manage",
  "scenarios:manage",
  "secrets:manage",
  // Agent cache — a member runs agents, and an agent writes its own run state.
  "agentCache:view",
  "agentCache:manage",
  "virtualKeys:create",
  "virtualKeys:update",
  "virtualKeys:rotate",
  // Langy — may run the assistant, not administer it.
  "langy:view",
  "langy:create",
  "langy:update",
  "langy:delete",
];

const ADMIN_ADDITIONS: readonly AuthzPermission[] = [
  "project:delete",
  "project:manage",
  "team:manage",
  "virtualKeys:delete",
  "virtualKeys:manage",
  "virtualKeys:viewOtherPersonal",
  "gatewayBudgets:create",
  "gatewayBudgets:update",
  "gatewayBudgets:delete",
  "gatewayBudgets:manage",
  "gatewayProviders:update",
  "gatewayProviders:manage",
  "routingPolicies:manage",
  "gatewayGuardrails:attach",
  "gatewayGuardrails:detach",
  "gatewayGuardrails:manage",
  "gatewayCacheRules:create",
  "gatewayCacheRules:update",
  "gatewayCacheRules:delete",
  "gatewayCacheRules:manage",
  "langy:manage",
];

/**
 * Lite member (legacy EXTERNAL org role): viewer-ish, minus every gateway
 * grant, plus annotation create/update — leadership and support users can
 * comment but not configure. Mirrors EXTERNAL_MEMBER_PERMISSIONS.
 */
const LITE_MEMBER: readonly AuthzPermission[] = [
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
];

/** Demo-project visitor: read-only product tour. Mirrors DEMO_VIEW_PERMISSIONS. */
const DEMO_VIEWER: readonly AuthzPermission[] = [
  "project:view",
  "analytics:view",
  "cost:view",
  "traces:view",
  "annotations:view",
  "datasets:view",
  "evaluations:view",
  "workflows:view",
  "experiments:view",
  "prompts:view",
  "scenarios:view",
  "playground:view",
];

const ORG_ADMIN: readonly AuthzPermission[] = [
  "organization:view",
  "organization:manage",
  "organization:delete",
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
  // Org admins run Langy at member level and administer its org surfaces.
  "langy:view",
  "langy:manage",
  "webhookEndpoints:view",
  "webhookEndpoints:manage",
  "gatewaySpend:view",
  "gatewaySpend:manage",
];

const ORG_MEMBER: readonly AuthzPermission[] = [
  "organization:view",
  "aiTools:view",
];

const ROLE_PERMISSION_SETS: Record<BuiltinRoleKey, ReadonlySet<string>> = {
  viewer: new Set(VIEWER),
  member: new Set([...VIEWER, ...MEMBER_ADDITIONS]),
  admin: new Set([...VIEWER, ...MEMBER_ADDITIONS, ...ADMIN_ADDITIONS]),
  "lite-member": new Set(LITE_MEMBER),
  "demo-viewer": new Set(DEMO_VIEWER),
  "org-admin": new Set(ORG_ADMIN),
  "org-member": new Set(ORG_MEMBER),
};

export function builtinRolePermissions(
  role: BuiltinRoleKey,
): ReadonlySet<string> {
  return ROLE_PERMISSION_SETS[role];
}

/** Hierarchy-aware grant test for a built-in role. */
export function builtinRoleGrants({
  role,
  permission,
}: {
  role: BuiltinRoleKey;
  permission: string;
}): boolean {
  return permissionSatisfiedBy({
    granted: ROLE_PERMISSION_SETS[role],
    requested: permission,
  });
}

/**
 * Legacy TeamUserRole / OrganizationUserRole → built-in role key. The CUSTOM
 * team role's *fallback* bag equals viewer (a non-empty custom role's own
 * permission list is authoritative and handled by the engine before this
 * mapping is consulted).
 */
export function roleKeyForTeamRole(
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM",
): BuiltinRoleKey {
  switch (role) {
    case "ADMIN":
      return "admin";
    case "MEMBER":
      return "member";
    case "VIEWER":
    case "CUSTOM":
      return "viewer";
  }
}
