// Five permission checkbox rules moved from component; tested as table.

import type { AuthzPermission } from "@langwatch/authz-contract";
import { actionOf, permissionsForResource, resourceOf } from "./permission-catalogue.ts";

/** The actions that cannot stand without `view`. */
const VIEW_DEPENDENT = ["create", "update", "delete"] as const;

function managePermissionOf(permission: string): AuthzPermission | null {
  const resource = resourceOf(permission);
  return (
    permissionsForResource(resource).find((candidate) => candidate === `${resource}:manage`) ?? null
  );
}

/** Whether the row is ticked because it was chosen. */
export function isPermissionSelected({
  selected,
  permission,
}: {
  selected: readonly AuthzPermission[];
  permission: AuthzPermission;
}): boolean {
  return selected.includes(permission);
}

/** Whether the row is ticked because `manage` on its resource is. */
export function isPermissionImplied({
  selected,
  permission,
}: {
  selected: readonly AuthzPermission[];
  permission: AuthzPermission;
}): boolean {
  if (actionOf(permission) === "manage") return false;
  const manage = managePermissionOf(permission);
  return manage !== null && selected.includes(manage);
}

/** Everything that leaves the list when this permission is unticked. */
export function permissionsRemovedBy(permission: AuthzPermission): AuthzPermission[] {
  const resource = resourceOf(permission);
  const offered = permissionsForResource(resource);

  if (permission.endsWith(":manage")) return offered;

  if (actionOf(permission) === "view") {
    return [
      permission,
      ...offered.filter((candidate) =>
        VIEW_DEPENDENT.some((action) => candidate.endsWith(`:${action}`)),
      ),
    ];
  }

  return [permission];
}

/** Everything that joins the list when this permission is ticked. */
export function permissionsAddedBy(permission: AuthzPermission): AuthzPermission[] {
  const resource = resourceOf(permission);
  const offered = permissionsForResource(resource);

  if (permission.endsWith(":manage")) return offered;

  const action = actionOf(permission);
  if (action === "create" || action === "update" || action === "delete") {
    const view = offered.find((candidate) => candidate === `${resource}:view`);
    return view ? [permission, view] : [permission];
  }

  return [permission];
}

/**
 * The list after one click, with rule 4 already applied.
 *
 * This is the whole of what the editor does to a role's permissions, so a
 * screen calls it and holds no rule of its own.
 */
export function togglePermission({
  selected,
  permission,
}: {
  selected: readonly AuthzPermission[];
  permission: AuthzPermission;
}): AuthzPermission[] {
  // Rule 4: a click on an implied row is a click on the manage that implies it.
  const implied = isPermissionImplied({ selected, permission });
  const manage = managePermissionOf(permission);
  const target = implied && manage ? manage : permission;

  const targetManage = managePermissionOf(target);
  const heldByManage =
    targetManage !== null && selected.includes(targetManage) && actionOf(target) !== "manage";
  const chosen = selected.includes(target);

  if (chosen || heldByManage) {
    const removed = permissionsRemovedBy(target);
    return selected.filter((candidate) => !removed.includes(candidate));
  }

  const added = permissionsAddedBy(target);
  return [...selected, ...added.filter((candidate) => !selected.includes(candidate))];
}
