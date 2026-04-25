import type { PrismaClient, Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { TokenResolver, type ResolvedToken } from "./token-resolver";
import { ApiKeyPermissionDeniedError } from "./errors";
import type { Permission } from "~/server/api/rbac";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";
import { DomainError } from "~/server/app-layer/domain-error";
import { createLogger } from "~/utils/logger/server";
import { getTokenType } from "./api-key-token.utils";

const logger = createLogger("langwatch:api:unified-auth");
const permissionLogger = createLogger("langwatch:api:api-key-ceiling");

/**
 * Variables set by the unified auth middleware.
 */
export type UnifiedAuthVariables = {
  project: Project;
  /** Set when the request was authenticated via API key (not legacy project key) */
  apiKeyId?: string;
  /** The user ID from the API key (not set for legacy project keys) */
  apiKeyUserId?: string;
  /** The organization ID from the API key */
  apiKeyOrganizationId?: string;
  /** The resolved token details */
  resolvedToken?: ResolvedToken;
};

/**
 * Parses the Authorization header to extract credentials for all supported
 * auth methods:
 *   1. Basic Auth: base64(projectId:token) — for SDKs
 *   2. Bearer: sk-lw-... or pat-lw-... + X-Project-Id header
 *   3. X-Auth-Token: legacy header (any token type)
 */
function extractCredentials(
  getHeader: (name: string) => string | undefined,
): { token: string; projectId: string | null } | null {
  const authHeader = getHeader("authorization");
  const xAuthToken = getHeader("x-auth-token");
  const xProjectId = getHeader("x-project-id");

  // Priority 1: Basic Auth — carries both projectId and token
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    const encoded = authHeader.slice(6);
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        const projectId = decoded.slice(0, colonIndex);
        const token = decoded.slice(colonIndex + 1);
        if (projectId && token) {
          return { token, projectId };
        }
      }
      // Fall through to X-Auth-Token below: a malformed Basic header (e.g.
      // injected by a corporate proxy for upstream auth) must not poison
      // the customer's legitimate X-Auth-Token credential.
    } catch {
      // Same fallthrough on undecodable base64.
    }
  }

  // Priority 2: Bearer token
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return { token, projectId: xProjectId ?? null };
    }
    // Empty Bearer also falls through to X-Auth-Token — same proxy-injection
    // hardening as Basic above.
  }

  // Priority 3: X-Auth-Token header (legacy)
  if (xAuthToken) {
    return { token: xAuthToken, projectId: xProjectId ?? null };
  }

  return null;
}

/**
 * Unified Hono auth middleware that handles all auth methods:
 *   - Basic Auth (base64 decode projectId:token)
 *   - Bearer API key (Authorization: Bearer sk-lw-... + X-Project-Id header)
 *   - Legacy (X-Auth-Token: sk-lw-... unchanged)
 *
 * Sets `project`, `apiKeyId`, `apiKeyUserId`, `apiKeyOrganizationId` on context.
 *
 * markUsed is late — called only after `next()` returns a 2xx response.
 */
export function createUnifiedAuthMiddleware({
  prisma,
}: {
  prisma: PrismaClient;
}): MiddlewareHandler {
  const resolver = TokenResolver.create(prisma);

  return async (c, next) => {
    const credentials = extractCredentials((name) => c.req.header(name));
    // Diagnostic context for auth failures — lets on-call attribute a 401 to
    // a specific customer/SDK without needing the customer to reproduce with
    // debug logs. Read once and reuse across both failure paths so values
    // are consistent. No raw token / body content is included.
    const diag = collectAuthDiagnostics(c);

    if (!credentials) {
      logger.warn(
        diag,
        diag.hasEmptyAuthToken
          ? "Authentication failed: X-Auth-Token sent but empty"
          : "Authentication failed: no auth header present",
      );
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
          ...diag,
          error,
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
      const tokenType = getTokenType(credentials.token);
      logger.warn(
        {
          ...diag,
          hasToken: true,
          tokenType,
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

    if (resolved.type === "apiKey") {
      c.set("apiKeyId", resolved.apiKeyId);
      c.set("apiKeyUserId", resolved.userId);
      c.set("apiKeyOrganizationId", resolved.organizationId);
    }

    await next();

    // Late markUsed: only when the handler produced a success response.
    if (
      resolved.type === "apiKey" &&
      c.res.status >= 200 &&
      c.res.status < 300
    ) {
      resolver.markUsed({ apiKeyId: resolved.apiKeyId });
    }
  };
}

export { extractCredentials };

/**
 * Diagnostic fields safe to emit on auth failure. Captures enough request
 * fingerprint to attribute 401s to a specific customer/SDK in CloudWatch
 * without leaking credentials or request bodies. `traceparent` lets us join
 * the failed POST to the customer's downstream OTel trace, which usually
 * carries identifying metadata even when the auth header path doesn't.
 *
 * `hasEmptyAuthToken` distinguishes "X-Auth-Token sent as an empty string"
 * (typically a customer-side env-var misconfig) from "no auth header at all"
 * (typically a misconfigured SDK or unauthenticated probe). Both produce the
 * same 401 today — the log line tells them apart.
 */
export type AuthDiagnostics = {
  path: string;
  method: string;
  userAgent: string | null;
  traceparent: string | null;
  forwardedFor: string | null;
  hasEmptyAuthToken: boolean;
};

export function collectAuthDiagnostics(c: {
  req: { path: string; method: string; header: (name: string) => string | undefined };
}): AuthDiagnostics {
  const get = (name: string) => c.req.header(name) ?? null;
  const xAuthToken = c.req.header("x-auth-token");
  return {
    path: c.req.path,
    method: c.req.method,
    userAgent: get("user-agent"),
    traceparent: get("traceparent"),
    forwardedFor: get("x-forwarded-for") ?? get("x-real-ip"),
    // Sent-but-empty is distinct from absent (SDK with a misconfigured
    // empty api_key still serializes the header).
    hasEmptyAuthToken: xAuthToken !== undefined && xAuthToken === "",
  };
}

/**
 * Enforces the API key permission ceiling for an already-resolved token.
 *
 * Legacy project keys are granted full access (current behavior — project API
 * keys bypass RBAC). API keys must satisfy `effective = ApiKey ∩ user` at the
 * project scope for the requested permission.
 *
 * Throws `ApiKeyPermissionDeniedError` when denied.
 */
export async function enforceApiKeyCeiling({
  prisma,
  resolved,
  permission,
}: {
  prisma: PrismaClient;
  resolved: ResolvedToken;
  permission: Permission;
}): Promise<void> {
  if (resolved.type !== "apiKey") return;

  const allowed = await resolveApiKeyPermission({
    prisma,
    apiKeyId: resolved.apiKeyId,
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
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        projectId: resolved.project.id,
        permission,
      },
      "API key ceiling check failed",
    );
    throw new ApiKeyPermissionDeniedError(permission, {
      meta: {
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        projectId: resolved.project.id,
      },
    });
  }
}

/**
 * Converts an API key permission denial into a Hono-style JSON response.
 * Re-throws anything that isn't an `ApiKeyPermissionDeniedError`.
 */
export function apiKeyCeilingDenialResponse(
  error: unknown,
): { error: string; message: string; status: 403 } {
  if (DomainError.isHandled(error) && error.kind === "api_key_permission_denied") {
    return { error: "Forbidden", message: error.message, status: 403 };
  }
  throw error;
}

/**
 * Hono middleware that applies the API key ceiling for a specific permission.
 * Must be chained AFTER createUnifiedAuthMiddleware — reads `resolvedToken`
 * from context.
 */
export function requireApiKeyPermission({
  prisma,
  permission,
}: {
  prisma: PrismaClient;
  permission: Permission;
}): MiddlewareHandler {
  return async (c, next) => {
    const resolved = c.get("resolvedToken") as ResolvedToken | undefined;
    if (!resolved) {
      return c.json(
        { error: "Unauthorized", message: "Authentication required" },
        401,
      );
    }

    try {
      await enforceApiKeyCeiling({ prisma, resolved, permission });
    } catch (error) {
      const denial = apiKeyCeilingDenialResponse(error);
      return c.json(
        { error: denial.error, message: denial.message },
        denial.status,
      );
    }

    await next();
  };
}
