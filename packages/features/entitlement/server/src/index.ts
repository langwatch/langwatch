export { EntitlementService, type EntitlementServiceOptions } from "./services/entitlement.service";
export { PlanTrpcApi, type PlanTrpcContext } from "./transport/api-trpc/plan.api";
export {
  LimitsTrpcApi,
  type LimitsTrpcContext,
  type LimitsTrpcPorts,
} from "./transport/api-trpc/limits.api";
export {
  CostTrpcApi,
  type CostTrpcContext,
  type CostTrpcPorts,
} from "./transport/api-trpc/cost.api";
export { USAGE_UNKNOWN, UsageCounterPort, type UsageCount } from "./ports/usage-counter.port";
export { UsageMembershipPort } from "./ports/usage-membership.port";
export { PrismaUsageMembershipRepository } from "./repositories/prisma/prisma.usage-membership.repository";
export {
  MESSAGE_LIMIT_WARNING_THRESHOLD,
  UsageStatsService,
  type UsageStatsCaller,
} from "./services/usage-stats.service";
export {
  MemberClassificationService,
  type MemberType,
  type RoleChangeType,
} from "./services/member-classification.service";
export {
  USAGE_UNIT_DISPLAY_LABELS,
  UsageMeterPolicyService,
  type MeterDecision,
} from "./services/usage-meter-policy.service";

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
} from "./services/usage-enforcement.service";
export {
  UsageLimitMessageService,
  type UsageDeployment,
} from "./services/usage-limit-message.service";
export { NoUsageCache, UsageCachePort } from "./ports/usage-cache.port";
export { UsageOrganizationPort, type UsageMeterReading } from "./ports/usage-organization.port";
export {
  UsageVolumeCounterPort,
  type ProjectUsageCount,
  type ProjectUsageCounts,
} from "./ports/usage-volume-counter.port";
