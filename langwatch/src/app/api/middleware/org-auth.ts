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

export const orgAuthMiddleware: MiddlewareHandler = createOrgAuthMiddleware({
  prisma,
});

/**
 * Authorizes an org-app route against the project it names, rather than the
 * organization. Org-scoped bindings still pass — they are ancestors of project
 * scope — while a team- or project-scoped grant reaches only its own projects.
 *
 * A project outside the caller's organization is reported as not found: its
 * existence is not the caller's to learn.
 */
export function requireProjectPermission({
  permission,
  param,
}: {
  permission: Permission;
  param: string;
}): MiddlewareHandler {
  return async (c, next) => {
    const organization = c.get("organization") as Organization;
    const projectId = c.req.param(param);

    const project = projectId
      ? await prisma.project.findUnique({
          where: { id: projectId },
          select: {
            id: true,
            team: { select: { id: true, organizationId: true } },
          },
        })
      : null;

    if (!project || project.team.organizationId !== organization.id) {
      return c.json({ error: "Not Found", message: "Project not found" }, 404);
    }

    const allowed = await resolveApiKeyPermission({
      prisma,
      apiKeyId: c.get("apiKeyId") as string,
      userId: c.get("apiKeyUserId") as string | null,
      organizationId: organization.id,
      scope: { type: "project", id: project.id, teamId: project.team.id },
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
