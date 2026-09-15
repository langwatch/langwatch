export {
  entitlementServer,
  createUsageMembershipRepository,
  classifyRoleChangeType,
  isViewOnlyCustomRole,
  createEntitlementService,
  createPlanNextStepService,
  createAbsentRequestBound,
} from "./entitlement.server.ts";
export type { EntitlementInfrastructure } from "./app/entitlement.app.ts";
export { planTrpcTransport } from "./transport/plan.trpc.ts";
export { usageLimitsTrpcTransport } from "./transport/usage-limits.trpc.ts";
export { organizationSpendTrpcTransport } from "./transport/organization-spend.trpc.ts";

/**
 * The pieces the api and worker composition roots still build the deployment's
 * plan sources, usage counters and seat readings from. They leave this file as
 * those roots move onto the installed feature.
 */
export {
  EntitlementService,
  type EntitlementServiceOptions,
} from "./services/entitlement.service.ts";
export {
  USAGE_UNKNOWN,
  type UsageCount,
  type UsageCounter,
  type UsageWarning,
} from "./app/entitlement.members.ts";
export type { UsageMembershipRepository } from "./repositories/usage-membership.repository.ts";
export { PrismaUsageMembershipRepository } from "./repositories/prisma/prisma.usage-membership.repository.ts";
export type { UsageStatsCaller } from "./services/usage-stats.service.ts";
export {
  MemberClassificationService,
  type MemberType,
  type RoleChangeType,
} from "./services/member-classification.service.ts";
export type { MeterDecision } from "./services/usage-meter-policy.service.ts";
export type {
  PlanResolver,
  UsageLimitResult,
  UsageServiceDependencies,
} from "./services/usage-enforcement.service.ts";
export type { UsageDeployment } from "./services/usage-limit-message.service.ts";
export { InProcessUsageCache, NoUsageCache } from "./services/usage-cache.service.ts";
export { type UsageCache } from "./app/entitlement.members.ts";
export { type UsageOrganization, type UsageMeterReading } from "./app/entitlement.members.ts";
export type { CataloguePlan, PlanCatalogueReader } from "./app/entitlement.app.ts";
export { PlanNextStepService } from "./services/plan-next-step.service.ts";
export {
  type UsageVolumeCounter,
  type ProjectUsageCount,
  type ProjectUsageCounts,
} from "./app/entitlement.members.ts";
