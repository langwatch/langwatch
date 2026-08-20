import type { AuthzPermission } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import type { Context, MiddlewareHandler } from "hono";
import {
  type ApiErrorEnvelope,
  authRefusalBody,
} from "~/app/api/shared/canonical-error";
import type { Organization } from "~/generated/prisma/client";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import type { OrgResolvedToken } from "~/server/api-key/token-resolver";
import { remediation } from "~/server/app-layer/error-remediation";
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
  permission: AuthzPermission;
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

/**
 * Whether the request's already-authenticated credential holds `permission`
 * at organization scope. The one implementation both the responding and the
 * throwing variant below call, so the two can never check differently.
 */
async function orgPermissionAllowed(
  c: Context,
  permission: AuthzPermission,
): Promise<boolean> {
  const apiKeyId = c.get("apiKeyId") as string;
  const userId = c.get("apiKeyUserId") as string | null;
  const organization = c.get("organization") as Organization | undefined;
  if (!organization) {
    throw new Error(
      "org permission middleware ran without an organization on context; mount it after the org auth middleware",
    );
  }
  const organizationId = organization.id;

  return resolveApiKeyPermission({
    prisma,
    apiKeyId,
    userId,
    organizationId,
    scope: { type: "org", id: organizationId },
    permission,
  });
}

export function requireOrgPermission(
  permission: AuthzPermission,
  errorEnvelope: ApiErrorEnvelope = "legacy",
): MiddlewareHandler {
  const refusal = authRefusalBody(errorEnvelope);
  return async (c, next) => {
    if (!(await orgPermissionAllowed(c, permission))) {
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

/**
 * The organization-scoped credential does not hold a permission the route
 * requires. `meta.required_permission` names it, so a caller can forward the
 * exact grant to ask an admin for rather than guessing from prose.
 */
export class InsufficientPermissionsError extends HandledError {
  declare readonly code: "insufficient_permissions";

  constructor(permission: AuthzPermission) {
    super(
      "insufficient_permissions",
      `Insufficient permissions. Required: ${permission}`,
      {
        httpStatus: 403,
        meta: { required_permission: permission },
        fault: "customer",
        ...remediation("insufficient_permissions"),
      },
    );
    this.name = "InsufficientPermissionsError";
  }
}

/**
 * {@link requireOrgPermission} for families whose error handler owns the
 * response shape: same check, but the denial is thrown as a `HandledError`
 * (`insufficient_permissions`, 403) instead of answered here. The response
 * then carries the remediation channel and whatever envelope the family
 * publishes, with no second copy of the refusal body to drift.
 */
export function requireOrgPermissionOrThrow(
  permission: AuthzPermission,
): MiddlewareHandler {
  return async (c, next) => {
    if (!(await orgPermissionAllowed(c, permission))) {
      throw new InsufficientPermissionsError(permission);
    }

    await next();
  };
}
