import {
  type AUTHZ_RESOURCES,
  type AuthzPermission,
  permissionResource,
} from "@langwatch/authorization";
import { isViewOnlyPermission } from "@langwatch/entitlement-contract";

/**
 * The resources whose writes manage a project or what holds it, not data under
 * its tenant. They stay open on an aggregate. Exempt by resource, never by
 * router, so a new procedure is guarded by the permission it declares.
 */
export const AGGREGATE_WRITE_EXEMPT_RESOURCES = [
  "organization",
  "project",
  "team",
] as const satisfies readonly (keyof typeof AUTHZ_RESOURCES)[];

const EXEMPT: ReadonlySet<string> = new Set(AGGREGATE_WRITE_EXEMPT_RESOURCES);

/** A view as the seat classifier counts it, plus `viewOtherPersonal`, which writes nothing. */
function onlyReads(permission: AuthzPermission): boolean {
  return (
    isViewOnlyPermission(permission) ||
    permission === `${permissionResource(permission)}:viewOtherPersonal`
  );
}

/** Whether a mutation under this permission writes data under its project; aggregates refuse it. */
export function writesUnderProject(permission: AuthzPermission): boolean {
  return !onlyReads(permission) && !EXEMPT.has(permissionResource(permission));
}
