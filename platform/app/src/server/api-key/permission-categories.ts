import {
  ALL_PERMISSIONS,
  AUTHZ_RESOURCES,
  type AuthzResource,
  permissionResource,
  permissionSatisfiedBy,
} from "@langwatch/authz";
import type { Permission } from "../api/rbac";

export type AccessLevel = "read" | "write";

export interface PermissionCategory {
  key: string;
  label: string;
  accessLevels: readonly AccessLevel[];
  readPermissions: Permission[];
  writePermissions: Permission[];
}

/**
 * Every registry permission of the given resources. The write level of a
 * category grants its resources wholesale, derived from the registry so a
 * new action can never be stranded outside the UI: the coverage test in
 * permission-categories.unit.test.ts pins categories to ALL_PERMISSIONS.
 */
function allActionsOf(...resources: AuthzResource[]): Permission[] {
  return resources.flatMap((resource) =>
    AUTHZ_RESOURCES[resource].actions.map(
      (action) => `${resource}:${action}` as Permission,
    ),
  );
}

function viewsOf(...resources: AuthzResource[]): Permission[] {
  return resources.map((resource) => `${resource}:view` as Permission);
}

/**
 * The resources the Gateway category grants as one unit: virtual keys,
 * budgets, providers, routing, guardrails, caching, usage/log/spend
 * reporting, and webhook endpoints.
 */
const GATEWAY_RESOURCES: AuthzResource[] = [
  "virtualKeys",
  "gatewayBudgets",
  "gatewayProviders",
  "routingPolicies",
  "gatewayGuardrails",
  "gatewayLogs",
  "gatewayUsage",
  "gatewayCacheRules",
  "gatewaySpend",
  "webhookEndpoints",
];

/**
 * The resources the Governance category grants as one unit. All of them are
 * org-exclusive at enforcement time (registry scopes: ["organization"]);
 * the category needs no special casing for that — a grant a binding cannot
 * carry simply never takes effect.
 */
const GOVERNANCE_RESOURCES: AuthzResource[] = [
  "governance",
  "ingestionSources",
  "anomalyRules",
  "complianceExport",
  "activityMonitor",
  "aiTools",
];

/** Setting up how people sign in, and how a directory provisions them —
 *  one resource, because the directory provisions against the connection. */
const IDENTITY_PROVIDER_RESOURCES = ["sso"] as const;

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  {
    key: "traces",
    label: "Traces",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("traces"),
    writePermissions: allActionsOf("traces"),
  },
  {
    key: "cost",
    label: "Cost",
    accessLevels: ["read"],
    readPermissions: viewsOf("cost"),
    writePermissions: [],
  },
  {
    key: "scenarios",
    label: "Scenarios",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("scenarios"),
    writePermissions: allActionsOf("scenarios"),
  },
  {
    key: "annotations",
    label: "Annotations",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("annotations"),
    writePermissions: allActionsOf("annotations"),
  },
  {
    key: "analytics",
    label: "Analytics",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("analytics"),
    writePermissions: allActionsOf("analytics"),
  },
  {
    key: "evaluations",
    label: "Evaluations",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("evaluations"),
    writePermissions: allActionsOf("evaluations"),
  },
  {
    key: "langy",
    label: "Langy",
    accessLevels: ["read", "write"],
    // Write here means "may run the assistant" — starting a turn provisions
    // credentials and spends model budget, so it is deliberately not part of
    // the read level.
    readPermissions: viewsOf("langy"),
    writePermissions: allActionsOf("langy"),
  },
  {
    key: "datasets",
    label: "Datasets",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("datasets"),
    writePermissions: allActionsOf("datasets"),
  },
  {
    key: "triggers",
    label: "Triggers",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("triggers"),
    writePermissions: allActionsOf("triggers"),
  },
  {
    key: "workflows",
    label: "Workflows",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("workflows"),
    writePermissions: allActionsOf("workflows"),
  },
  {
    key: "experiments",
    label: "Experiments",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("experiments"),
    writePermissions: allActionsOf("experiments"),
  },
  {
    key: "prompts",
    label: "Prompts",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("prompts"),
    writePermissions: allActionsOf("prompts"),
  },
  {
    key: "playground",
    label: "Playground",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("playground"),
    writePermissions: allActionsOf("playground"),
  },
  {
    key: "secrets",
    label: "Secrets",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("secrets"),
    writePermissions: allActionsOf("secrets"),
  },
  {
    key: "auditLog",
    label: "Audit Log",
    accessLevels: ["read"],
    readPermissions: viewsOf("auditLog"),
    writePermissions: [],
  },
  {
    key: "team",
    label: "Team",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("team"),
    writePermissions: allActionsOf("team"),
  },
  {
    // One category, because the role model gives no way to split it:
    // `project:manage` is the umbrella grant for the project resource, and
    // `hasPermissionWithHierarchy` answers a `project:create` or
    // `project:delete` check with it. A category that offered project
    // settings without project creation would describe a separation the
    // request path does not make.
    key: "project",
    label: "Project",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("project"),
    writePermissions: allActionsOf("project"),
  },
  {
    key: "organization",
    label: "Organization",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("organization"),
    writePermissions: allActionsOf("organization"),
  },
  {
    key: "gateway",
    label: "Gateway",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf(...GATEWAY_RESOURCES),
    writePermissions: allActionsOf(...GATEWAY_RESOURCES),
  },
  {
    key: "governance",
    label: "Governance",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf(...GOVERNANCE_RESOURCES),
    writePermissions: allActionsOf(...GOVERNANCE_RESOURCES),
  },
  {
    // Single sign-on and the directory that provisions people (D05). Its own
    // category rather than a corner of Organization, because this is the one
    // an IT administrator is given and the rest of the organization's
    // settings are not — which is the whole point of the split.
    key: "identityProvider",
    label: "Single sign-on and directory",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf(...IDENTITY_PROVIDER_RESOURCES),
    writePermissions: allActionsOf(...IDENTITY_PROVIDER_RESOURCES),
  },
] as const;

/**
 * The registry permissions the categories deliberately do NOT cover: the
 * platform tier (`scopes: ["platform"]`), which is grantable only to
 * platform staff and can never ride on an API key. Everything else in
 * ALL_PERMISSIONS belongs to at least one category — enforced by
 * permission-categories.unit.test.ts so the registry cannot drift out of
 * the UI again.
 */
export function categorizablePermissions(): Permission[] {
  return [...ALL_PERMISSIONS].filter((permission) => {
    const def =
      AUTHZ_RESOURCES[permissionResource(permission) as AuthzResource];
    return !(def.scopes as readonly string[]).includes("platform");
  }) as Permission[];
}

export function categoryPermissions({
  key,
  level,
}: {
  key: string;
  level: AccessLevel;
}): Permission[] {
  const category = PERMISSION_CATEGORIES.find((c) => c.key === key);
  if (!category) return [];
  return level === "write"
    ? category.writePermissions
    : category.readPermissions;
}

export function computePermissionsFromSelections(
  selections: Record<string, AccessLevel | "none">,
): Permission[] {
  const permSet = new Set<Permission>();
  for (const [key, level] of Object.entries(selections)) {
    if (level === "none") continue;
    for (const perm of categoryPermissions({ key, level })) {
      permSet.add(perm);
    }
  }
  return [...permSet].sort();
}

export function selectionsFromPermissions(
  permissions: string[],
): Record<string, AccessLevel> {
  const granted = new Set(permissions);

  // Hierarchy-aware so a stored list carrying `datasets:manage` still
  // satisfies `datasets:create` (keys stored before the write lists were
  // expanded keep reading as "write"). The implication rides only on a manage
  // grant the category itself carries, so one category's manage can never
  // mark another category granted.
  const heldWithinCategory = (
    category: PermissionCategory,
    permission: Permission,
  ) =>
    granted.has(permission) ||
    category.writePermissions.some(
      (writePermission) =>
        writePermission.endsWith(":manage") &&
        granted.has(writePermission) &&
        permissionSatisfiedBy({
          granted: new Set([writePermission]),
          requested: permission,
        }),
    );

  const selections: Record<string, AccessLevel> = {};
  for (const category of PERMISSION_CATEGORIES) {
    const hasWrite =
      category.writePermissions.length > 0 &&
      category.writePermissions.every((p) => heldWithinCategory(category, p));
    // A write-only category (no read permissions) must never fall back to
    // "read": there is nothing a read level would grant.
    const hasRead =
      category.readPermissions.length > 0 &&
      category.readPermissions.every((p) => heldWithinCategory(category, p));

    if (hasWrite) {
      selections[category.key] = "write";
    } else if (hasRead && category.accessLevels.includes("read")) {
      selections[category.key] = "read";
    }
  }
  return selections;
}
