export { EntitlementApp } from "./app/entitlement.app.ts";
export type { EntitlementInfrastructure } from "./app/entitlement.app.ts";
export { entitlementServer } from "./entitlement.server.ts";
export {
  EntitlementService,
  type EntitlementServiceOptions,
} from "./services/entitlement.service.ts";
export { PlanTrpcApi, type PlanTrpcContext } from "./transport/api-trpc/plan.api.ts";
export {
  LimitsTrpcApi,
  type LimitsTrpcContext,
  type LimitsTrpcPorts,
} from "./transport/api-trpc/limits.api.ts";
export {
  CostTrpcApi,
  type CostTrpcContext,
  type CostTrpcPorts,
} from "./transport/api-trpc/cost.api.ts";
export { USAGE_UNKNOWN, UsageCounterPort, type UsageCount } from "./ports/usage-counter.port.ts";
export { UsageMembershipPort } from "./ports/usage-membership.port.ts";
export { PrismaUsageMembershipRepository } from "./repositories/prisma/prisma.usage-membership.repository.ts";
export {
  MESSAGE_LIMIT_WARNING_THRESHOLD,
  UNCAPPED_MONTHLY_USAGE_LIMIT,
  UsageStatsService,
  type UsageStatsCaller,
} from "./services/usage-stats.service.ts";
export {
  MemberClassificationService,
  type MemberType,
  type RoleChangeType,
} from "./services/member-classification.service.ts";
export {
  USAGE_UNIT_DISPLAY_LABELS,
  UsageMeterPolicyService,
  type MeterDecision,
} from "./services/usage-meter-policy.service.ts";

/**
 * Enforcement: the plan's allowance measured against the month's real volume.
 * Was `platform/app/src/server/app-layer/usage/`.
 */
export {
  OrganizationNotFoundForTeamError,
  UsageService,
  type PlanResolver,
  type UsageLimitResult,
  type UsageServiceDependencies,
} from "./services/usage-enforcement.service.ts";
export {
  UsageLimitMessageService,
  type UsageDeployment,
} from "./services/usage-limit-message.service.ts";
export { InProcessUsageCache, NoUsageCache, UsageCachePort } from "./ports/usage-cache.port.ts";
export { UsageOrganizationPort, type UsageMeterReading } from "./ports/usage-organization.port.ts";
export { PlanCataloguePort, type CataloguePlan } from "./ports/plan-catalogue.port.ts";
export { PlanNextStepService } from "./services/plan-next-step.service.ts";
export {
  UsageVolumeCounterPort,
  type ProjectUsageCount,
  type ProjectUsageCounts,
} from "./ports/usage-volume-counter.port.ts";
