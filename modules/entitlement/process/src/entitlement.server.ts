import type { OrganizationUserRole } from "@langwatch/authz-contract";
import { defineServerModule } from "@langwatch/kernel";

import { EntitlementApp } from "./app/entitlement.app.ts";
import type { PlanCatalogueReader } from "./app/entitlement.app.ts";
import { entitlementUsageWarningEventing } from "./eventing/entitlement-usage-warning.pipeline.ts";
import { entitlementRepositories } from "./repositories/entitlement-repositories.registry.ts";
import {
  PrismaUsageMembershipRepository,
  type PrismaUsageMembershipDatabase,
} from "./repositories/prisma/prisma.usage-membership.repository.ts";
import type { UsageMembershipRepository } from "./repositories/usage-membership.repository.ts";
import {
  getRoleChangeType,
  isViewOnlyCustomRole as classifyViewOnlyCustomRole,
  type RoleChangeType,
} from "./rules/member-classification.rules.ts";
import {
  EntitlementService,
  type EntitlementServiceOptions,
} from "./services/entitlement.service.ts";
import { PlanNextStepService } from "./services/plan-next-step.service.ts";
import { organizationSpendTrpcTransport } from "./transport/organization-spend.trpc.ts";
import { planTrpcTransport } from "./transport/plan.trpc.ts";
import { usageLimitsTrpcTransport } from "./transport/usage-limits.trpc.ts";

export type { EntitlementInfrastructure } from "./app/entitlement.app.ts";
export { createAbsentRequestBound } from "./app/entitlement-composition.build.ts";

export const entitlementServer = defineServerModule("entitlement")
  .withRepositories(entitlementRepositories)
  .withApp(EntitlementApp)
  .withTransports(planTrpcTransport, usageLimitsTrpcTransport, organizationSpendTrpcTransport)
  .withEventing(entitlementUsageWarningEventing);

/**
 * Runtime seams: thin factories over this feature's private classes, so a
 * composition root never names one directly (private-runtime-export drive,
 * dev/docs/plans/private-runtime-export-drive.md §3d).
 */

export function createUsageMembershipRepository(
  prisma: PrismaUsageMembershipDatabase,
): UsageMembershipRepository {
  return PrismaUsageMembershipRepository.create(prisma);
}

export function classifyRoleChangeType(input: {
  oldRole: OrganizationUserRole;
  oldPermissions: string[] | undefined;
  newRole: OrganizationUserRole;
  newPermissions: string[] | undefined;
}): RoleChangeType {
  return getRoleChangeType(
    input.oldRole,
    input.oldPermissions,
    input.newRole,
    input.newPermissions,
  );
}

export function isViewOnlyCustomRole(permissions: string[]): boolean {
  return classifyViewOnlyCustomRole(permissions);
}

export function createEntitlementService(options: EntitlementServiceOptions): EntitlementService {
  return EntitlementService.create(options);
}

export function createPlanNextStepService(options: {
  catalogue: PlanCatalogueReader;
}): PlanNextStepService {
  return PlanNextStepService.create(options);
}
