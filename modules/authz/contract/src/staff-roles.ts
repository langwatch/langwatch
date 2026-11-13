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
  "org:metadata",
  "org:content",
  "org:support",
] as const;

export type StaffAccessScope = (typeof STAFF_ACCESS_SCOPES)[number];

/**
 * How an organization is set up and used: projects, analytics, cost, evaluator and trigger
 * settings. No prompt text, trace, dataset or run content; run results and stored files are
 * refused to a key without `org:content` at the route (`.servesContent()`).
 */
export const STAFF_READER_METADATA_PERMISSIONS: readonly AuthzPermission[] = [
  "project:view",
  "analytics:view",
  "cost:view",
  "evaluations:view",
  "triggers:view",
  "workflows:view",
  "gatewayUsage:view",
];

/** What the organization and its end users wrote: prompts, traces, datasets, annotations, runs. */
export const STAFF_READER_CONTENT_PERMISSIONS: readonly AuthzPermission[] = [
  "prompts:view",
  "traces:view",
  "datasets:view",
  "annotations:view",
  "experiments:view",
  "scenarios:view",
];

/**
 * The writes a support key may make: evaluators, monitors, datasets, scenarios, dashboards. No
 * prompt (a prompt write can deploy to production) and no trigger (a trigger sends data out).
 */
export const STAFF_SUPPORT_WRITE_PERMISSIONS: readonly AuthzPermission[] = [
  "evaluations:create",
  "evaluations:update",
  "datasets:create",
  "datasets:update",
  "scenarios:create",
  "scenarios:update",
  "analytics:create",
  "analytics:update",
];

/**
 * The writes a support key makes without the spend tick: datasets only. Every other write in the
 * bag shapes what runs and is charged (an evaluator's model, a monitor, a scenario, a dashboard's
 * eval() column), so the staff gate refuses it unless the session was approved to spend.
 */
export const STAFF_WRITES_WITHOUT_SPEND: readonly AuthzPermission[] = [
  "datasets:create",
  "datasets:update",
];

/**
 * The permissions an approved set of scopes grants in its one organization, each once. `ops:read`
 * grants none here: it is answered by the staff access door, never by a key in an organization.
 */
export function staffAccessPermissions({
  scopes,
}: {
  scopes: readonly StaffAccessScope[];
}): AuthzPermission[] {
  const reachesOrganization = scopes.some((scope) => scope !== "ops:read");
  if (!reachesOrganization) return [];

  const granted = new Set<AuthzPermission>(STAFF_READER_METADATA_PERMISSIONS);
  if (scopes.includes("org:content")) {
    for (const permission of STAFF_READER_CONTENT_PERMISSIONS) granted.add(permission);
  }
  if (scopes.includes("org:support")) {
    for (const permission of STAFF_SUPPORT_WRITE_PERMISSIONS) granted.add(permission);
  }

  return [...granted];
}
