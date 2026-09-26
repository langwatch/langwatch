import {
  ALL_PERMISSIONS,
  AUTHZ_RESOURCES,
  type AuthzPermission,
  type AuthzResource,
  permissionResource,
  permissionSatisfiedBy,
} from "@langwatch/authz-contract";
import type { z } from "zod";

export const API_KEY_PERMISSION_MODES = ["all", "readonly", "restricted"] as const;

export function refineRestrictedPermissions(
  data: {
    permissionMode?: string;
    permissions?: string[];
    bindings?: { role: string }[];
  },
  ctx: z.RefinementCtx,
): void {
  const isRestricted = data.permissionMode === "restricted";
  const hasCustomBinding = data.bindings?.some((b) => b.role === "CUSTOM") ?? false;
  const hasPermissions = Boolean(data.permissions?.length);
  if (!isRestricted && !hasCustomBinding && !hasPermissions) return;
  if (!isRestricted)
    ctx.addIssue({
      code: "custom",
      message: "CUSTOM permissions require permissionMode 'restricted'",
      path: ["permissionMode"],
    });
  if (!hasCustomBinding)
    ctx.addIssue({
      code: "custom",
      message: "restricted mode requires at least one CUSTOM binding",
      path: ["bindings"],
    });
  if (!hasPermissions)
    ctx.addIssue({
      code: "custom",
      message: "restricted mode requires at least one permission",
      path: ["permissions"],
    });
}

export type AccessLevel = "read" | "write";

export interface PermissionCategory {
  key: string;
  label: string;
  accessLevels: readonly AccessLevel[];
  readPermissions: AuthzPermission[];
  writePermissions: AuthzPermission[];
}

/**
 * Every registry permission of the given resources, wholesale — derived
 * from the registry so a new action is never stranded outside the UI. See
 * permission-categories.unit.test.ts's coverage test.
 */
function allActionsOf(...resources: AuthzResource[]): AuthzPermission[] {
  return resources.flatMap((resource) =>
    AUTHZ_RESOURCES[resource].actions.map((action) => `${resource}:${action}` as AuthzPermission),
  );
}

function viewsOf(...resources: AuthzResource[]): AuthzPermission[] {
  return resources.map((resource) => `${resource}:view` as AuthzPermission);
}

/** The resources the Gateway category grants as one unit. */
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
 * The resources the Governance category grants as one unit. All are
 * org-exclusive at enforcement (registry scopes: ["organization"]); a grant
 * a binding cannot carry simply never takes effect.
 */
const GOVERNANCE_RESOURCES: AuthzResource[] = [
  "governance",
  "ingestionSources",
  "anomalyRules",
  "complianceExport",
  "activityMonitor",
  "aiTools",
  "governanceCost",
];

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
    key: "agentCache",
    label: "Agent Cache",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("agentCache"),
    writePermissions: allActionsOf("agentCache"),
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
    // `project:manage` is the umbrella grant, and `hasPermissionWithHierarchy`
    // answers `project:create`/`project:delete` checks with it — splitting
    // settings from creation would describe a separation the request path
    // does not make.
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
    key: "sso",
    label: "Single sign-on and directory sync",
    accessLevels: ["read", "write"],
    readPermissions: viewsOf("sso"),
    writePermissions: allActionsOf("sso"),
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
    // Write only: the registry declares no `featureFlags:view`, and
    // `featureFlags:manageExperiments` sets the experiment enrolment policy.
    // Its own category, not a line in Governance, because it is grantable at
    // the project tier too, unlike governance's org-exclusive resources.
    // Distinct from "Experiments", the evaluation product.
    key: "featureFlags",
    label: "Feature Flags",
    accessLevels: ["write"],
    readPermissions: [],
    writePermissions: allActionsOf("featureFlags"),
  },
] as const;

/**
 * What the categories deliberately do NOT cover: the platform tier
 * (`scopes: ["platform"]`), grantable only to platform staff, never on an
 * API key. Enforced by permission-categories.unit.test.ts.
 */
export function categorizablePermissions(): AuthzPermission[] {
  return [...ALL_PERMISSIONS].filter((permission) => {
    const def = AUTHZ_RESOURCES[permissionResource(permission) as AuthzResource];
    return !(def.scopes as readonly string[]).includes("platform");
  }) as AuthzPermission[];
}

/**
 * The permissions a CLI login key leaves out unless the login asked for
 * management access (`langwatch login --management`), each with what it lets
 * the CLI do, as the approval screen lists it.
 */
export const CLI_KEY_MANAGEMENT_PERMISSIONS = {
  "organization:manage": "Manage the organization's settings, members and roles",
  "organization:delete": "Delete the organization",
  "team:manage": "Create teams and manage their members",
} as const satisfies Partial<Record<AuthzPermission, string>>;

export type CliKeyManagementPermission = keyof typeof CLI_KEY_MANAGEMENT_PERMISSIONS;

export const cliKeyManagementPermissions = (): CliKeyManagementPermission[] =>
  Object.keys(CLI_KEY_MANAGEMENT_PERMISSIONS) as CliKeyManagementPermission[];

export const isCliKeyManagementPermission = (
  permission: string,
): permission is CliKeyManagementPermission =>
  Object.hasOwn(CLI_KEY_MANAGEMENT_PERMISSIONS, permission);

/** The permissions a CLI login key starts from; the management ones only when asked for. */
export function defaultCliKeyPermissions({
  management = false,
}: { management?: boolean } = {}): AuthzPermission[] {
  return categorizablePermissions().filter(
    (permission) => management || !isCliKeyManagementPermission(permission),
  );
}

export function categoryPermissions({
  key,
  level,
}: {
  key: string;
  level: AccessLevel;
}): AuthzPermission[] {
  const category = PERMISSION_CATEGORIES.find((c) => c.key === key);
  if (!category) return [];
  return level === "write" ? category.writePermissions : category.readPermissions;
}

export function computePermissionsFromSelections(
  selections: Record<string, AccessLevel | "none">,
): AuthzPermission[] {
  const permSet = new Set<AuthzPermission>();
  for (const [key, level] of Object.entries(selections)) {
    if (level === "none") continue;
    for (const perm of categoryPermissions({ key, level })) {
      permSet.add(perm);
    }
  }
  return [...permSet].toSorted();
}

export function selectionsFromPermissions(permissions: string[]): Record<string, AccessLevel> {
  const granted = new Set(permissions);

  // Hierarchy-aware so a stored list carrying `datasets:manage` still
  // satisfies `datasets:create` (keys stored before the write lists were
  // expanded keep reading as "write"). The implication rides only on a manage
  // grant the category itself carries, so one category's manage can never
  // mark another category granted.
  const heldWithinCategory = (category: PermissionCategory, permission: AuthzPermission) =>
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
