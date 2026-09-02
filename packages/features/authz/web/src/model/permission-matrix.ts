/**
 * What a click on one permission checkbox does to a custom role's permission
 * list.
 *
 * MOVED EXACTLY, and pulled out of the component that held it. In
 * `platform/app/src/components/settings/PermissionSelector.tsx` these five
 * rules lived as closures over a `useMemo`d grouping, which is why they had no
 * test: driving them meant mounting a two-hundred-checkbox Chakra fieldset and
 * reading a callback payload back out. As values they are a table, and the
 * table is what `__tests__/permission-matrix.unit.test.ts` pins.
 *
 * THE FIVE RULES, unchanged:
 *
 * 1. `manage` on a resource IMPLIES every other action the editor offers on it.
 *    Ticking it selects them all; unticking it deselects them all.
 * 2. `create`, `update` and `delete` REQUIRE `view`, so ticking any of them
 *    ticks `view` too — when the registry admits a `view` on that resource.
 * 3. Unticking `view` unticks `create`, `update` and `delete` with it, because
 *    they cannot stand without it.
 * 4. A row that is only implicitly ticked — ticked because `manage` is — sends
 *    its click to the `manage` that implies it. Toggling the row itself would
 *    be a no-op, since it is not in the list.
 * 5. Nothing outside the registry is ever added: the offerable set comes from
 *    {@link permissionsForResource}, which filters through the authorization
 *    contract's own vocabulary.
 *
 * `share` is the reason rule 1 says "every other action the editor OFFERS"
 * rather than the CRUD four: traces offer view and share, and share is not a
 * sub-action of manage anywhere in the registry — but the platform rule
 * expanded `manage` to the whole offered group, and a move does not get to
 * improve on that. Traces offer no manage, so the case does not arise today;
 * the wording is what keeps it honest if one is ever added.
 */

import type { AuthzPermission } from "@langwatch/authz-contract";
import { actionOf, permissionsForResource, resourceOf } from "./permission-catalogue";

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
