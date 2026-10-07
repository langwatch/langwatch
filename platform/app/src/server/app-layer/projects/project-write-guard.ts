import type { AUTHZ_RESOURCES, AuthzPermission } from "@langwatch/authz";
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

/** The actions that only read. Every other action writes. */
const READ_ACTIONS: ReadonlySet<string> = new Set([
  "view",
  "viewOtherPersonal",
]);

const EXEMPT: ReadonlySet<string> = new Set(AGGREGATE_WRITE_EXEMPT_RESOURCES);

/**
 * Whether a mutation declared under this permission writes data under the
 * project it names, and so must be refused on an aggregate (ADR-144
 * decision 8).
 */
export function writesUnderProject(permission: AuthzPermission): boolean {
  const [resource = "", action = ""] = permission.split(":");
  return !READ_ACTIONS.has(action) && !EXEMPT.has(resource);
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
  kinds: { kindOf(projectId: string): Promise<string | null> };
  projectId: string;
}): Promise<void> {
  if (isAggregateProjectKind(await kinds.kindOf(projectId))) {
    throw new AggregateProjectIsReadOnlyError();
  }
}
