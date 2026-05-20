import type { PrismaClient } from "@prisma/client";
import type { Permission } from "~/server/api/rbac";
import { PermissionsService } from "~/server/app-layer/permissions/permissions.service";

/**
 * Asserts that a user holds the given permission on a project.
 *
 * Thin wrapper around {@link PermissionsService#requireProjectPermission} that
 * accepts a caller-supplied Prisma client, keeping backward compatibility with
 * existing call sites that pass `prisma` as a named parameter.
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
  const service = new PermissionsService(prisma);
  return service.requireProjectPermission({ userId, projectId, permission });
}
