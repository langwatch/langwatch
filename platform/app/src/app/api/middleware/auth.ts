import type { Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import type { ApiErrorEnvelope } from "~/app/api/shared/canonical-error";
import type { Permission } from "~/server/api/rbac";
import {
  requireApiKeyPermission as createRequireApiKeyPermission,
  createUnifiedAuthMiddleware,
} from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";

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
export const authMiddleware: MiddlewareHandler = createUnifiedAuthMiddleware({
  prisma,
});

/**
 * The same authentication, refusing in the canonical error envelope.
 *
 * Route families publish one error shape, and authentication runs beneath the
 * family's own error handler, so a canonical family needs its 401s rendered
 * canonically here rather than as the flat legacy body.
 */
export const canonicalAuthMiddleware: MiddlewareHandler =
  createUnifiedAuthMiddleware({ prisma, errorEnvelope: "canonical" });

/**
 * Per-endpoint RBAC middleware. Legacy project keys always pass through;
 * service/user API keys are checked against their role bindings.
 */
export function requirePermission(
  permission: Permission,
  errorEnvelope: ApiErrorEnvelope = "legacy",
): MiddlewareHandler {
  return createRequireApiKeyPermission({ prisma, permission, errorEnvelope });
}
