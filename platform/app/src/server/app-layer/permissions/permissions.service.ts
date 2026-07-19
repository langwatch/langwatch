import type { PrismaClient } from "@prisma/client";
import { OrganizationUserRole } from "@prisma/client";
import type { Permission } from "~/server/api/rbac";
import { resolveProjectPermission } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { LiteMemberRestrictedError } from "./errors";

/**
 * Service responsible for project-level permission enforcement.
 *
 * Pure business logic — no tRPC dependency. Safe to call from Hono routes,
 * background workers, or any other non-tRPC surface.
 */
export class PermissionsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Asserts that a user holds the given permission on a project.
   *
   * Throws {@link LiteMemberRestrictedError} when the denial is caused by the
   * user being a Lite Member (EXTERNAL org role). Throws a plain `Error` for
   * all other denials (not a member, or member without the permission).
   *
   * @param params.userId     - The authenticated user's ID.
   * @param params.projectId  - The project being accessed.
   * @param params.permission - The permission that must be held.
   */
  async requireProjectPermission({
    userId,
    projectId,
    permission,
  }: {
    userId: string;
    projectId: string;
    permission: Permission;
  }): Promise<void> {
    const ctx = {
      prisma: this.prisma,
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
}
