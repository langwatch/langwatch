import type { PrismaClient, Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { TokenResolver, type ResolvedToken } from "./token-resolver";
import type { Permission } from "~/server/api/rbac";
import { resolvePatPermission } from "~/server/rbac/role-binding-resolver";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:unified-auth");
const permissionLogger = createLogger("langwatch:api:pat-ceiling");

/**
 * Variables set by the unified auth middleware, extending the existing
 * AuthMiddlewareVariables shape.
 */
export type UnifiedAuthVariables = {
  project: Project;
  /** Set when the request was authenticated via PAT */
  patId?: string;
  /** The user ID from the PAT (not set for legacy keys) */
  patUserId?: string;
  /** The organization ID from the PAT */
  patOrganizationId?: string;
  /** The resolved token details */
  resolvedToken?: ResolvedToken;
};

/**
 * Parses the Authorization header to extract credentials for all supported
 * auth methods:
 *   1. Basic Auth: base64(projectId:token) — for SDKs
 *   2. Bearer PAT: pat-lw-... + X-Project-Id header
 *   3. Bearer Legacy: sk-lw-... (project ID implicit in key)
 *   4. X-Auth-Token: legacy header (any token type)
 */
function extractCredentials(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}): { token: string; projectId: string | null } | null {
  const authHeader = c.req.header("authorization");
  const xAuthToken = c.req.header("x-auth-token");
  const xProjectId = c.req.header("x-project-id");

  // Priority 1: Basic Auth — carries both projectId and token
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    const encoded = authHeader.slice(6);
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      const colonIndex = decoded.indexOf(":");
      if (colonIndex === -1) return null;

      const projectId = decoded.slice(0, colonIndex);
      const token = decoded.slice(colonIndex + 1);
      if (!projectId || !token) return null;

      return { token, projectId };
    } catch {
      return null;
    }
  }

  // Priority 2: Bearer token
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7);
    if (!token) return null;
    return { token, projectId: xProjectId ?? null };
  }

  // Priority 3: X-Auth-Token header (legacy)
  if (xAuthToken) {
    return { token: xAuthToken, projectId: xProjectId ?? null };
  }

  return null;
}

/**
 * Unified Hono auth middleware that handles all three auth methods:
 *   - Basic Auth (base64 decode projectId:pat)
 *   - Bearer PAT (Authorization: Bearer pat-lw-... + X-Project-Id header)
 *   - Legacy (X-Auth-Token: sk-lw-... unchanged)
 *
 * Sets `project`, `patId`, `patUserId`, `patOrganizationId` on the context.
 *
 * Takes a PrismaClient via injection so the middleware isn't coupled to the
 * module-scope `~/server/db` global and can be exercised with a test client
 * or a per-request Prisma instance.
 *
 * markUsed is late — called only after `next()` returns a 2xx response. This
 * keeps `lastUsedAt` aligned with *successful* request outcomes rather than
 * merely successful authentication, mirroring the route-owned pattern in
 * `collector.ts`.
 */
export function createUnifiedAuthMiddleware({
  prisma,
}: {
  prisma: PrismaClient;
}): MiddlewareHandler {
  const resolver = TokenResolver.create(prisma);

  return async (c, next) => {
    const credentials = extractCredentials(c);

    if (!credentials) {
      return c.json(
        {
          error: "Unauthorized",
          message:
            "Authentication required. Use Authorization: Basic base64(projectId:token), Authorization: Bearer <token>, or X-Auth-Token header.",
        },
        401,
      );
    }

    let resolved: ResolvedToken | null;
    try {
      resolved = await resolver.resolve({
        token: credentials.token,
        projectId: credentials.projectId,
      });
    } catch (error) {
      logger.error(
        {
          error,
          path: c.req.path,
          method: c.req.method,
        },
        "Database error during authentication",
      );

      return c.json(
        {
          error: "Internal Server Error",
          message: "Authentication service error",
        },
        500,
      );
    }

    if (!resolved) {
      logger.warn(
        {
          hasToken: true,
          tokenType: credentials.token.startsWith("pat-lw-")
            ? "pat"
            : credentials.token.startsWith("sk-lw-")
              ? "legacy"
              : "unknown",
          hasProjectId: !!credentials.projectId,
        },
        "Authentication failed: invalid credentials",
      );
      return c.json(
        { error: "Unauthorized", message: "Invalid credentials" },
        401,
      );
    }

    c.set("project", resolved.project);
    c.set("resolvedToken", resolved);

    if (resolved.type === "pat") {
      c.set("patId", resolved.patId);
      c.set("patUserId", resolved.userId);
      c.set("patOrganizationId", resolved.organizationId);
    }

    await next();

    // Late markUsed: only when the handler produced a success response. Keeps
    // lastUsedAt tied to successful request outcomes, not mere authentication.
    if (
      resolved.type === "pat" &&
      c.res.status >= 200 &&
      c.res.status < 300
    ) {
      resolver.markUsed({ patId: resolved.patId });
    }
  };
}

export { extractCredentials };

/**
 * Enforces the PAT permission ceiling for an already-resolved token.
 *
 * Legacy tokens are granted full access (current behavior — project API keys
 * bypass RBAC). PAT tokens must satisfy `effective = PAT ∩ user` at the
 * project scope for the requested permission.
 *
 * Returns `null` when access is granted, or an error descriptor the caller
 * can surface as a 403. This helper exists so both Hono middleware and
 * inline route handlers (collector, otel) share one enforcement path.
 *
 * `prisma` is injected rather than imported from module scope so the helper
 * doesn't leak infrastructure; callers already hold a client to construct
 * TokenResolver and can pass the same instance.
 */
export async function enforcePatCeiling({
  prisma,
  resolved,
  permission,
}: {
  prisma: PrismaClient;
  resolved: ResolvedToken;
  permission: Permission;
}): Promise<{ error: string; status: 403 } | null> {
  if (resolved.type !== "pat") return null;

  const allowed = await resolvePatPermission({
    prisma,
    patId: resolved.patId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    scope: {
      type: "project",
      id: resolved.project.id,
      teamId: resolved.project.team.id,
    },
    permission,
  });

  if (!allowed) {
    permissionLogger.warn(
      {
        patId: resolved.patId,
        userId: resolved.userId,
        projectId: resolved.project.id,
        permission,
      },
      "PAT ceiling check failed",
    );
    return {
      error: `PAT lacks required permission: ${permission}`,
      status: 403,
    };
  }

  return null;
}

/**
 * Hono middleware that applies the PAT ceiling for a specific permission.
 * Must be chained AFTER createUnifiedAuthMiddleware — reads `resolvedToken`
 * from context. Accepts a PrismaClient via injection so enforcement never
 * reaches for a module-scope client.
 */
export function requirePatPermission({
  prisma,
  permission,
}: {
  prisma: PrismaClient;
  permission: Permission;
}): MiddlewareHandler {
  return async (c, next) => {
    const resolved = c.get("resolvedToken") as ResolvedToken | undefined;
    if (!resolved) {
      // No token resolved — auth middleware should have run first.
      return c.json(
        { error: "Unauthorized", message: "Authentication required" },
        401,
      );
    }

    const denial = await enforcePatCeiling({ prisma, resolved, permission });
    if (denial) {
      return c.json({ error: "Forbidden", message: denial.error }, denial.status);
    }

    await next();
  };
}
