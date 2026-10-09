/**
 * Which writes an aggregate project refuses (ADR-175 decision 8). Pure, so the
 * server's guards and the browser's controls ask the same question.
 */
import {
  type AUTHZ_RESOURCES,
  type AuthzPermission,
  permissionResource,
} from "@langwatch/authorization";
import { isViewOnlyPermission } from "@langwatch/entitlement-contract";

import { isAggregateProjectKind } from "./project-kinds.ts";
import { AggregateProjectIsReadOnlyError } from "./project.errors.ts";

/**
 * The resources whose writes manage a project, or what holds it, rather than
 * write data under its tenant. Exempt by resource, never by route, so a new
 * route is guarded or exempt by the permission it declares.
 */
export const AGGREGATE_WRITE_EXEMPT_RESOURCES = [
  "organization",
  "project",
  "team",
] as const satisfies readonly (keyof typeof AUTHZ_RESOURCES)[];

const EXEMPT: ReadonlySet<string> = new Set(AGGREGATE_WRITE_EXEMPT_RESOURCES);

/**
 * A view, as the seat classifier counts it, plus `viewOtherPersonal`: it widens
 * whose data a seat reads, but writes nothing under any tenant.
 */
function onlyReads(permission: AuthzPermission): boolean {
  return (
    isViewOnlyPermission(permission) ||
    permission === `${permissionResource(permission)}:viewOtherPersonal`
  );
}

/** Whether a write declared under this permission writes data under the project it names. */
export function writesUnderProject(permission: AuthzPermission): boolean {
  return !onlyReads(permission) && !EXEMPT.has(permissionResource(permission));
}

/** Whether data may be written under a project of this kind; an unknown kind may. */
export function projectKindAcceptsWrites(kind: string | null | undefined): boolean {
  return !isAggregateProjectKind(kind);
}

/** Refuses a write under a project of the aggregate kind with the read-only answer. */
export function assertProjectKindAcceptsWrites(kind: string | null | undefined): void {
  if (!projectKindAcceptsWrites(kind)) throw new AggregateProjectIsReadOnlyError();
}
