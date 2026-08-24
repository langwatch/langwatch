import {
  PostgresScimTokenAdapter,
  ScimEntitlementProvider,
  type ScimTokenDatabase,
  type ScimTokenService,
} from "@langwatch/enterprise-scim-server";
export {
  CREATE_GROUP,
  CREATE_USER,
  DELETE_GROUP,
  DELETE_USER,
  GET_GROUP,
  GET_SERVICE_PROVIDER_CONFIG,
  GET_USER,
  LIST_GROUPS,
  LIST_RESOURCE_TYPES,
  LIST_SCHEMAS,
  LIST_USERS,
  PATCH_GROUP,
  PATCH_USER,
  REPLACE_GROUP,
  REPLACE_USER,
  SCIM_SPEC_OPTIONS,
} from "@langwatch/enterprise-scim-server";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";

class AppScimEntitlementProvider extends ScimEntitlementProvider {
  async isEntitled(organizationId: string): Promise<boolean> {
    const plan = await getApp().planProvider.getActivePlan({ organizationId });
    return isEnterpriseTier(plan.type);
  }
}

export const createScimTokenService = (
  database: ScimTokenDatabase = prisma,
): ScimTokenService =>
  PostgresScimTokenAdapter.create({
    database,
    entitlements: new AppScimEntitlementProvider(),
  }).build();
