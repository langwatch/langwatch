export { entitlementServer } from "./entitlement.server.ts";
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
export { USAGE_UNKNOWN, UsageCounterPort, type UsageCount } from "./ports/usage-counter.port.ts";
export { UsageWarningPort } from "./ports/usage-warning.port.ts";
export type { UsageMembershipRepository } from "./repositories/usage-membership.repository.ts";
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
