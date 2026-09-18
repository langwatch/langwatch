// Permission editor vocabulary; family-local copy bounded by registry.

import { type AuthzPermission, isRegistryPermission } from "@langwatch/authz-contract";

/** Core actions that can be performed on resources. */
export const AUTHZ_ACTIONS = {
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  MANAGE: "manage",
  SHARE: "share",
} as const;

export type AuthzAction = (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS];

/**
 * The resources a custom role may be written against, in editor order.
 * Organization and Team authority is managed at a higher level and not
 * offered here; the playground is hidden deliberately.
 */
export const ORDERED_RESOURCES = [
  "traces",
  "cost",
  "scenarios",
  "annotations",
  "analytics",
  "evaluations",
  "datasets",
  "triggers",
  "workflows",
  "experiments",
  "prompts",
  "secrets",
  "auditLog",
  "team",
  "project",
  // AI Governance — admins can grant subsets to custom roles
  // (for example "security analyst" gets governance:view + activityMonitor:view).
  "governance",
  "ingestionSources",
  "anomalyRules",
  "complianceExport",
  "activityMonitor",
  // AI Tools Portal — view defaults to all organization roles and manage is
  // administrator-only, so a custom role is how a scoped editor gets manage.
  "aiTools",
] as const;

export type AuthzResource = (typeof ORDERED_RESOURCES)[number];

const VIEW_ONLY: readonly AuthzResource[] = [
  "cost",
  "scenarios",
  // The audit log is read-only; rows are emitted by other services and never
  // mutated through this surface, so only :view is meaningful.
  "auditLog",
  // The OCSF SIEM export and the activity monitor are read-only too: their rows
  // are derived from governance folds, never created or deleted through them.
  "complianceExport",
  "activityMonitor",
];

const VIEW_AND_MANAGE: readonly AuthzResource[] = ["secrets", "experiments"];

/** Which actions the editor offers for one resource. */
export function validActionsForResource(resource: AuthzResource): AuthzAction[] {
  if (VIEW_ONLY.includes(resource)) return [AUTHZ_ACTIONS.VIEW];
  if (resource === "traces") return [AUTHZ_ACTIONS.VIEW, AUTHZ_ACTIONS.SHARE];
  if (VIEW_AND_MANAGE.includes(resource)) return [AUTHZ_ACTIONS.VIEW, AUTHZ_ACTIONS.MANAGE];
  return [
    AUTHZ_ACTIONS.MANAGE,
    AUTHZ_ACTIONS.VIEW,
    AUTHZ_ACTIONS.CREATE,
    AUTHZ_ACTIONS.UPDATE,
    AUTHZ_ACTIONS.DELETE,
  ];
}

/**
 * One resource's offerable permissions. The registry is the vocabulary the
 * engine grants from, so the per-resource action table above produces the
 * full resource x action cross product, filtered to what the registry allows.
 */
export function permissionsForResource(resource: AuthzResource): AuthzPermission[] {
  return validActionsForResource(resource)
    .map((action) => `${resource}:${action}`)
    .filter(isRegistryPermission);
}

/** Every resource's offerable permissions, in editor order. */
export function permissionsByResource(): Record<AuthzResource, AuthzPermission[]> {
  const grouped = {} as Record<AuthzResource, AuthzPermission[]>;
  for (const resource of ORDERED_RESOURCES) {
    grouped[resource] = permissionsForResource(resource);
  }
  return grouped;
}

/** The action half of a permission string, or undefined when it has none. */
export function actionOf(permission: string): AuthzAction | undefined {
  const action = permission.split(":")[1];
  return action === void 0 ? void 0 : (action as AuthzAction);
}

/** The resource half of a permission string. */
export function resourceOf(permission: string): AuthzResource {
  return permission.split(":")[0] as AuthzResource;
}
