import type { Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { TokenResolver, type ResolvedToken } from "./token-resolver";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:unified-auth");

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
 *   1. Basic Auth: base64(projectId:token) — for SDKs, Langfuse compat
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
 */
export function createUnifiedAuthMiddleware(): MiddlewareHandler {
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

    try {
      const resolved = await resolver.resolve({
        token: credentials.token,
        projectId: credentials.projectId,
      });

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

      if (resolved.type === "pat") {
        c.set("patId", resolved.patId);
        c.set("patUserId", resolved.userId);
        c.set("patOrganizationId", resolved.organizationId);
        // Middleware path: mark used after successful authentication.
        // Downstream routes run their own validation; the audit trail
        // here reflects "last successful authentication" per-route.
        resolver.markUsed({ patId: resolved.patId });
      }

      c.set("resolvedToken", resolved);
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

    await next();
  };
}

// Re-export for backwards compatibility with existing auth middleware consumers
export { extractCredentials };
