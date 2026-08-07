import type { Organization } from "~/generated/prisma/client";
import type { MiddlewareHandler } from "hono";
import {
  type ApiErrorEnvelope,
  authRefusalBody,
} from "~/app/api/shared/canonical-error";
import type { Permission } from "~/server/api/rbac";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import type { OrgResolvedToken } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
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
 * The same check for families that publish the canonical error envelope. Two
 * instances rather than one parameterised at request time: each builds its own
 * token resolver once, and the choice is fixed per family anyway.
 */
export const canonicalOrgAuthMiddleware: MiddlewareHandler =
  createOrgAuthMiddleware({ prisma, errorEnvelope: "canonical" });

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
  errorEnvelope = "legacy",
}: {
  permission: Permission;
  param: string;
  errorEnvelope?: ApiErrorEnvelope;
}): MiddlewareHandler {
  const refusal = authRefusalBody(errorEnvelope);
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
      return c.json(
        refusal({
          status: 404,
          code: "project_not_found",
          legacyError: "Not Found",
          message: "Project not found",
        }),
        404,
      );
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
        refusal({
          status: 403,
          code: "insufficient_permissions",
          legacyError: "Forbidden",
          message: `Insufficient permissions. Required: ${permission}`,
          meta: { required_permission: permission },
        }),
        403,
      );
    }

    await next();
  };
}

export function requireOrgPermission(
  permission: Permission,
  errorEnvelope: ApiErrorEnvelope = "legacy",
): MiddlewareHandler {
  const refusal = authRefusalBody(errorEnvelope);
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
        refusal({
          status: 403,
          code: "insufficient_permissions",
          legacyError: "Forbidden",
          message: `Insufficient permissions. Required: ${permission}`,
          meta: { required_permission: permission },
        }),
        403,
      );
    }

    await next();
  };
}
