import type { AuthzPermission } from "@langwatch/authz-contract";
import { categorizablePermissions } from "./permission-categories";

/**
 * Permissions a CLI login key does NOT get by default. The key a
 * `langwatch login` mints inherits the user's access for day-to-day work
 * (traces, datasets, prompts, gateway, model providers, ...), but a leaked
 * key must not be able to change RBAC or the organization itself.
 *
 * `project:create` and `project:delete` are NOT on this list, and cannot be:
 * model providers, project settings and topic clustering all check
 * `project:manage`, and `hasPermissionWithHierarchy` answers a create or
 * delete check with that same manage grant. Naming them here would withhold
 * them from the stored list while the request path still allowed the call.
 * A user who wants project administration off the key sets Project to Read
 * on the authorize screen, which drops `project:manage` with it.
 *
 * The platform tier (`ops:*`) is not on this list because it is excluded
 * structurally: the defaults start from `categorizablePermissions()`, which
 * drops every permission on a platform-scoped resource, so a platform
 * resource added later can never reach the defaults through a name list.
 *
 * The user can still opt in to any of these on the authorize screen; this
 * list only shapes the default selection and is enforced nowhere else —
 * request-time enforcement is the key's bindings intersected with the
 * owner's live permissions.
 */
export const CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS: readonly AuthzPermission[] =
  ["organization:manage", "organization:delete", "team:manage"];

const excluded = new Set<string>(CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS);

/** The default permission list for a CLI login key. */
export function defaultCliKeyPermissions(): AuthzPermission[] {
  return categorizablePermissions().filter(
    (permission) => !excluded.has(permission),
  ) as AuthzPermission[];
}
