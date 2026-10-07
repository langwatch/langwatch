import {
  type AUTHZ_RESOURCES,
  type AuthzPermission,
  permissionResource,
} from "@langwatch/authz";
import { isViewOnlyPermission } from "~/server/license-enforcement/member-classification";
import { AggregateProjectIsReadOnlyError } from "./errors";
import { isAggregateProjectKind } from "./project-kinds";

/**
 * The resources whose writes manage a project, or what holds it, rather
 * than write data under its tenant: renaming or archiving the project, its
 * rule, its team, its organisation. They stay open on an aggregate, which an
 * admin must still be able to manage. Exempt by resource, never by router,
 * so a new procedure is guarded or exempt by the permission it declares.
 */
export const AGGREGATE_WRITE_EXEMPT_RESOURCES = [
  "organization",
  "project",
  "team",
] as const satisfies readonly (keyof typeof AUTHZ_RESOURCES)[];

const EXEMPT: ReadonlySet<string> = new Set(AGGREGATE_WRITE_EXEMPT_RESOURCES);

/**
 * Whether a permission only reads. A view, as the seat classifier counts it,
 * plus `viewOtherPersonal`: it reads other members' personal resources, which
 * the seat classifier counts as more than a view because it widens whose data
 * a seat sees, but it writes nothing under any tenant.
 */
function onlyReads(permission: AuthzPermission): boolean {
  return (
    isViewOnlyPermission(permission) ||
    permission === `${permissionResource(permission)}:viewOtherPersonal`
  );
}

/**
 * Whether a mutation declared under this permission writes data under the
 * project it names, and so must be refused on an aggregate (ADR-144
 * decision 8).
 */
export function writesUnderProject(permission: AuthzPermission): boolean {
  return !onlyReads(permission) && !EXEMPT.has(permissionResource(permission));
}

/**
 * Refuses a write under an aggregate project. The permission middleware asks
 * this for every mutation {@link writesUnderProject} names, before the
 * handler runs, so hiding the aggregate's Build and Test navigation is a
 * convenience and not the guard. A project of any other kind, or one the
 * reader does not know, is left to the handler.
 */
export async function assertProjectAcceptsWrites({
  kinds,
  projectId,
}: {
  kinds: ProjectKinds;
  projectId: string;
}): Promise<void> {
  if (!(await projectAcceptsWrites({ kinds, projectId }))) {
    throw new AggregateProjectIsReadOnlyError();
  }
}

/**
 * Whether data may be written under this project. The question a read that
 * seeds a default on first open (the first dashboard, the trace list's
 * saved views) asks before it writes: it is a query, so the mutation guard
 * never sees it, and on an aggregate it returns what exists and writes
 * nothing instead of refusing a page the admin is allowed to open.
 */
export async function projectAcceptsWrites({
  kinds,
  projectId,
}: {
  kinds: ProjectKinds;
  projectId: string;
}): Promise<boolean> {
  return !isAggregateProjectKind(await kinds.kindOf(projectId));
}

type ProjectKinds = { kindOf(projectId: string): Promise<string | null> };
