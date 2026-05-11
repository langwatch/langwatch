import type { Organization } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { createOrgAuthMiddleware } from "~/server/pat/auth-middleware";
import type { OrgResolvedToken } from "~/server/pat/token-resolver";

export type OrgAuthMiddlewareVariables = {
  organization: Organization;
  patId: string;
  patUserId: string;
  patOrganizationId: string;
  orgResolvedToken: OrgResolvedToken;
};

export const orgAuthMiddleware: MiddlewareHandler =
  createOrgAuthMiddleware({ prisma });
