import type { Project } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { createUnifiedAuthMiddleware } from "~/server/api-key/auth-middleware";

/**
 * Variables set by the auth middleware.
 * Extended to include optional PAT fields from the unified middleware.
 */
export type AuthMiddlewareVariables = {
  project: Project;
  apiKeyId?: string;
  apiKeyUserId?: string;
  apiKeyOrganizationId?: string;
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
