import type { Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import {
  createUnifiedAuthMiddleware,
  requireApiKeyPermission as createRequireApiKeyPermission,
} from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import type { Permission } from "~/server/api/rbac";

/**
 * Variables set by the auth middleware.
 * Extended to include optional API-key fields from the unified middleware.
 */
export type AuthMiddlewareVariables = {
  project: Project;
  apiKeyId?: string;
  apiKeyUserId?: string;
  apiKeyOrganizationId?: string;
  /**
   * The full resolved credential. Always set by the unified middleware;
   * optional here because other middlewares sharing this Variables shape
   * do not set it. Handlers that need to know WHICH kind of credential
   * called (scoped API key vs legacy project key) read this.
   */
  resolvedToken?: ResolvedToken;
};

/**
 * Unified auth middleware that handles all auth methods:
 *   - Basic Auth: base64(projectId:token)
 *   - Bearer PAT: pat-lw-... + X-Project-Id
 *   - Bearer Legacy: sk-lw-...
 *   - X-Auth-Token: legacy header
 */
export const authMiddleware: MiddlewareHandler =
  createUnifiedAuthMiddleware({ prisma });

/**
 * Per-endpoint RBAC middleware. Legacy project keys always pass through;
 * service/user API keys are checked against their role bindings.
 */
export function requirePermission(permission: Permission): MiddlewareHandler {
  return createRequireApiKeyPermission({ prisma, permission });
}
