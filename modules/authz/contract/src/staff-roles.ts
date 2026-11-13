/**
 * The permission bags an approved staff agent's key carries in one organization (ADR-202). They
 * are applied as a CUSTOM binding at organization scope on an ownerless, restricted key, so these
 * lists are the whole reach: no member, credential, billing, delete or manage permission.
 */
import type { AuthzPermission } from "@langwatch/authorization";

/** The role key of a read-only staff key ("LangWatch Staff Read"). */
export const STAFF_READER_ROLE_KEY = "staff-reader" as const;

/** The role key of a staff support key ("LangWatch Support"). */
export const STAFF_SUPPORT_ROLE_KEY = "staff-support" as const;

/** Every scope an operator may approve for an agent. */
export const STAFF_ACCESS_SCOPES = [
  "ops:read",
  "copy:source",
  "copy:target",
  "org:metadata",
  "org:content",
  "org:support",
] as const;

export type StaffAccessScope = (typeof STAFF_ACCESS_SCOPES)[number];

/** The two sides of an organization copy; each is approved alone and names both organizations. */
export const STAFF_ACCESS_COPY_SCOPES: readonly StaffAccessScope[] = ["copy:source", "copy:target"];

/** The scopes answered by the staff access door; they never mint an organization key. */
export const STAFF_ACCESS_PLATFORM_SCOPES: readonly StaffAccessScope[] = [
  "ops:read",
  ...STAFF_ACCESS_COPY_SCOPES,
];

/** Whether the scopes reach into one organization, which mints an organization key. */
export function reachesOrganization(scopes: readonly StaffAccessScope[]): boolean {
  return scopes.some((scope) => !STAFF_ACCESS_PLATFORM_SCOPES.includes(scope));
}

/** Whether the request names an organization: an organization key or a side of a copy. */
export function namesOrganization(scopes: readonly StaffAccessScope[]): boolean {
  return (
    reachesOrganization(scopes) || scopes.some((scope) => STAFF_ACCESS_COPY_SCOPES.includes(scope))
  );
}

/**
 * Exactly what an approved `copy:target` lets the server create in the target organization:
 * projects, evaluators, monitors (created, then paused), prompt versions and datasets. The
 * approval page lists it and the passkey signs it; the copy checks each item against it.
 */
export const STAFF_COPY_TARGET_PERMISSIONS: readonly AuthzPermission[] = [
  "project:create",
  "evaluations:create",
  "evaluations:update",
  "prompts:create",
  "prompts:update",
  "datasets:create",
];

/** The grant a set of scopes gives a copy in its target organization; empty for any other. */
export function staffCopyGrant(scopes: readonly string[]): AuthzPermission[] {
  return scopes.includes("copy:target") ? [...STAFF_COPY_TARGET_PERMISSIONS] : [];
}

/** How an organization is set up and used, with no trace, dataset or run content. */
export const STAFF_READER_METADATA_PERMISSIONS: readonly AuthzPermission[] = [
  "project:view",
  "analytics:view",
  "cost:view",
  "evaluations:view",
  "prompts:view",
  "triggers:view",
  "workflows:view",
  "gatewayUsage:view",
];

/** What the organization's end users and runs wrote: traces, datasets, annotations, runs. */
export const STAFF_READER_CONTENT_PERMISSIONS: readonly AuthzPermission[] = [
  "traces:view",
  "datasets:view",
  "annotations:view",
  "experiments:view",
  "scenarios:view",
];

/** The writes a support key may make: evaluators, monitors, prompts, datasets, scenarios. */
export const STAFF_SUPPORT_WRITE_PERMISSIONS: readonly AuthzPermission[] = [
  "evaluations:create",
  "evaluations:update",
  "prompts:create",
  "prompts:update",
  "datasets:create",
  "datasets:update",
  "scenarios:create",
  "scenarios:update",
  "analytics:create",
  "analytics:update",
  "triggers:create",
  "triggers:update",
];

/**
 * The permissions an approved set of scopes grants in its one organization's key, each once.
 * `ops:read` and the copy scopes grant none here: the staff access door answers them, never a key.
 */
export function staffAccessPermissions({
  scopes,
}: {
  scopes: readonly StaffAccessScope[];
}): AuthzPermission[] {
  if (!reachesOrganization(scopes)) return [];

  const granted = new Set<AuthzPermission>(STAFF_READER_METADATA_PERMISSIONS);
  if (scopes.includes("org:content")) {
    for (const permission of STAFF_READER_CONTENT_PERMISSIONS) granted.add(permission);
  }
  if (scopes.includes("org:support")) {
    for (const permission of STAFF_SUPPORT_WRITE_PERMISSIONS) granted.add(permission);
  }

  return [...granted];
}
