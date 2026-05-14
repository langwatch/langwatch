import type { PrismaClient } from "@prisma/client";
import { OrganizationUserRole } from "@prisma/client";
import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";
import type { Permission } from "~/server/api/rbac";
import { resolveProjectPermission } from "~/server/api/rbac";
import type { Session } from "~/server/auth";

/**
 * Asserts that a user holds the given permission on a project.
 *
 * Pure async function — no tRPC dependency. Safe to call from Hono routes,
 * background workers, or any other non-tRPC surface.
 *
 * Throws {@link LiteMemberRestrictedError} when the denial is caused by the
 * user being a Lite Member (EXTERNAL org role). Throws a plain `Error` for
 * all other denials (not a member, or member without the permission).
 *
 * @param params.userId     - The authenticated user's ID.
 * @param params.projectId  - The project being accessed.
 * @param params.permission - The permission that must be held.
 * @param params.prisma     - Prisma client instance (injected for testability).
 */
export async function requireProjectPermission({
  userId,
  projectId,
  permission,
  prisma,
}: {
  userId: string;
  projectId: string;
  permission: Permission;
  prisma: PrismaClient;
}): Promise<void> {
  const ctx = {
    prisma,
    // Minimal session shape — resolveProjectPermission only accesses user.id.
    // Other Session fields (expires, sessionId, etc.) are not read by the
    // permission resolver, so we satisfy the interface with an empty expires.
    session: { user: { id: userId }, expires: "" } satisfies Session,
  };

  const { permitted, organizationRole } = await resolveProjectPermission(
    ctx,
    projectId,
    permission,
  );

  if (!permitted) {
    if (organizationRole === OrganizationUserRole.EXTERNAL) {
      throw new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown");
    }
    throw new Error("You do not have permission to access this project resource");
  }
}
