import type { Organization } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import type { OrgResolvedToken } from "~/server/api-key/token-resolver";
import type { Permission } from "~/server/api/rbac";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";

export type OrgAuthMiddlewareVariables = {
  organization: Organization;
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: OrgResolvedToken;
};

export const orgAuthMiddleware: MiddlewareHandler =
  createOrgAuthMiddleware({ prisma });

export function requireOrgPermission(
  permission: Permission,
): MiddlewareHandler {
  return async (c, next) => {
    const apiKeyId = c.get("apiKeyId") as string;
    const userId = c.get("apiKeyUserId") as string | null;
    const organizationId = (c.get("organization") as Organization).id;

    const allowed = await resolveApiKeyPermission({
      prisma,
      apiKeyId,
      userId,
      organizationId,
      scope: { type: "org", id: organizationId },
      permission,
    });

    if (!allowed) {
      return c.json(
        {
          error: "Forbidden",
          message: `Insufficient permissions. Required: ${permission}`,
        },
        403,
      );
    }

    await next();
  };
}
