import type { Organization } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import type { OrgResolvedToken } from "~/server/api-key/token-resolver";

export type OrgAuthMiddlewareVariables = {
  organization: Organization;
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: OrgResolvedToken;
};

export const orgAuthMiddleware: MiddlewareHandler =
  createOrgAuthMiddleware({ prisma });
