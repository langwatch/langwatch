/**
 * Which permissions the role editor OFFERS, and in what order.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/utils/permissionsConfig.ts`, which
 * keeps three server-side test consumers of its own and so did not travel.
 * The action and resource vocabulary it read from `~/utils/rbacVocabulary` did
 * not travel either — that module has ten remaining callers across the server,
 * the API application and the Langy contract — so the two constants it exports
 * are restated here as the browser half of the same vocabulary.
 *
 * THE RESTATEMENT IS BOUNDED BY THE REGISTRY, which is what keeps it honest.
 * Nothing here decides what a permission MEANS: every string this module
 * produces is filtered through `isRegistryPermission` before it reaches a
 * checkbox, so a resource or action that drifts out of
 * `@langwatch/authz-contract` stops being offered rather than being offered and
 * refused. The list below can therefore only ever be a subset of the engine's
 * vocabulary, never a second opinion about it.
 *
 * The obligation stands until `orderedResources` and the action table move into
 * the authorization contract, at which point this file is deleted rather than
 * kept in step.
 */

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
 * The resources a custom role may be written against, in the order the editor
 * lists them.
 *
 * Organization and Team authority is managed at a higher level and is not
 * offered here; the playground is hidden deliberately. Both omissions travel
 * from the platform module's own comments.
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
 * One resource's offerable permissions.
 *
 * The registry is the vocabulary the engine grants from, so it is the
 * vocabulary the settings UI offers: the per-resource action table above
 * produces the full resource x action cross product, most of which no grant can
 * ever carry.
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
