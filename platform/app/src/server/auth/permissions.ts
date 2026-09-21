import type { Permission } from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";

/**
 * Asserts that a user holds the given permission on a project.
 *
 * Thin wrapper around the App-composed permissions service
 * (`getApp().permissions`) for non-tRPC surfaces — Hono routes, background
 * workers, anywhere with a userId and a projectId in hand.
 *
 * Throws {@link LiteMemberRestrictedError} when the denial is caused by the
 * user being a Lite Member (EXTERNAL org role), and
 * {@link ProjectPermissionDeniedError} for every other denial (not a member,
 * or member without the permission). Both are handled errors carrying a code.
 *
 * @param params.userId     - The authenticated user's ID.
 * @param params.projectId  - The project being accessed.
 * @param params.permission - The permission that must be held.
 */
export async function requireProjectPermission({
  userId,
  projectId,
  permission,
}: {
  userId: string;
  projectId: string;
  permission: Permission;
}): Promise<void> {
  return getApp().permissions.requireProjectPermission({
    userId,
    projectId,
    permission,
  });
}
