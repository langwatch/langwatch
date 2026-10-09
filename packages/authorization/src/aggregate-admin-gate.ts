/**
 * ADR-177 decisions 5 and 8: the two rules an aggregate project carries at
 * the door. Pure: the door reads the project's kind with its scope and asks
 * these, so no handler and no module re-derives them.
 */
import type { PermissionDecision } from "./decision.ts";
import { AggregateProjectIsReadOnlyError } from "./errors.ts";
import { type AUTHZ_RESOURCES, type AuthzPermission, permissionResource } from "./registry.ts";
import { isOrgScopedPermission } from "./scope-tiers.ts";

/** The `Project.kind` of a project that reads its members and owns no traces. */
export const AGGREGATE_PROJECT_KIND = "aggregate";

/** Whether this kind is the aggregate kind. */
export function isAggregateProjectKind(kind: string | null | undefined): boolean {
  return kind === AGGREGATE_PROJECT_KIND;
}

/**
 * Decision 5: only an organisation admin opens an aggregate. Being on its
 * team is never a silent read of other people's projects, so a permitted
 * non-admin is refused as if no grant reached the project.
 */
export function applyAggregateAdminGate<
  D extends Pick<PermissionDecision, "permitted" | "organizationRole" | "denialReason">,
>({ decision, kind }: { decision: D; kind: string | null | undefined }): D {
  if (!decision.permitted || decision.organizationRole === "ADMIN") return decision;
  if (!isAggregateProjectKind(kind)) return decision;

  return { ...decision, permitted: false, denialReason: "no-grant" };
}

/**
 * The resources whose writes manage a project or what holds it, not data
 * under its tenant; they stay open on an aggregate. Exempt by resource, so a
 * new procedure is guarded by the permission it declares.
 */
export const AGGREGATE_WRITE_EXEMPT_RESOURCES = [
  "organization",
  "project",
  "team",
] as const satisfies readonly (keyof typeof AUTHZ_RESOURCES)[];

const EXEMPT: ReadonlySet<string> = new Set(AGGREGATE_WRITE_EXEMPT_RESOURCES);
const READ_ACTIONS: ReadonlySet<string> = new Set(["view", "viewOtherPersonal"]);

/** Whether a mutation under this permission writes data under its project (decision 8). */
export function writesUnderProject(permission: AuthzPermission): boolean {
  const action = permission.split(":")[1] ?? "";

  return !READ_ACTIONS.has(action) && !EXEMPT.has(permissionResource(permission));
}

/**
 * Decision 8 in the client: a permission is refused on a project of this kind
 * when it writes under the aggregate. An organization-level write names no
 * project, so the server lets it through and the client does too.
 */
export function refusedOnAggregate({
  kind,
  permission,
}: {
  kind: string | null | undefined;
  permission: AuthzPermission;
}): boolean {
  if (!isAggregateProjectKind(kind)) return false;
  return !isOrgScopedPermission(permission) && writesUnderProject(permission);
}

/** Decision 8: nothing is written under an aggregate's tenant. */
export function assertProjectAcceptsWrites({ kind }: { kind: string | null | undefined }): void {
  if (isAggregateProjectKind(kind)) throw new AggregateProjectIsReadOnlyError();
}
