export {
  EntitlementService,
  type EntitlementServiceOptions,
} from "./services/entitlement.service";
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
export {
  USAGE_UNKNOWN,
  UsageCounterPort,
  type UsageCount,
} from "./ports/usage-counter.port";
export { UsageMembershipPort } from "./ports/usage-membership.port";
export { PrismaUsageMembershipRepository } from "./repositories/prisma/prisma.usage-membership.repository";
export {
  buildMessageLimitInfo,
  getMessageLimitStatus,
  MESSAGE_LIMIT_WARNING_THRESHOLD,
  UsageStatsService,
  type UsageStatsCaller,
} from "./services/usage-stats.service";
export {
  classifyMemberType,
  getRoleChangeType,
  isFullMember,
  isLiteMember,
  isViewOnlyCustomRole,
  isViewOnlyPermission,
  type MemberType,
  type RoleChangeType,
} from "./services/member-classification.service";
export {
  normalizeUsageUnit,
  resolveUsageMeter,
  USAGE_UNIT_DISPLAY_LABELS,
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
} from "./services/usage-enforcement.service";
export {
  buildLimitMessage,
  buildUpgradeUrl,
  type UsageDeployment,
} from "./services/usage-limit-message.service";
export {
  NoUsageCache,
  UsageCachePort,
  UsageOrganizationPort,
  UsageVolumeCounterPort,
  type ProjectUsageCount,
  type ProjectUsageCounts,
  type UsageMeterReading,
} from "./ports/usage-enforcement.ports";
