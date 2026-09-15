/**
 * What a process composes billing's process-side work from: the ClickHouse,
 * Redis and Stripe substrates it already holds, and the rows it was handed.
 * Every repository and service behind these stays private to this feature
 * server — a composition states which substrates it has, never which class to
 * construct.
 */
import type { BillableEventsMeter } from "./repositories/billable-events-meter.repository.ts";
import { BillableEventsMeterClickHouseRepository } from "./repositories/clickhouse/clickhouse.billable-events-meter.repository.ts";
import type { BillableEventsMeterClickHouseClientResolver } from "./repositories/clickhouse/clickhouse.billable-events-meter.repository.ts";
import {
  ClickhouseClickHouseRepository,
  type BillingClickHouseClientResolver,
} from "./repositories/clickhouse/clickhouse.clickhouse.repository.ts";
import type { BillingOrganizationCache } from "./repositories/organization/billing-organization-cache.repository.ts";
import type { BillingTenantOrganization } from "./repositories/organization/tenant-organization.repository.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "./repositories/redis/redis.billing-organization-cache.repository.ts";
import {
  RedisTenantOrganizationCacheRepository,
  type BillingTenantOrganizationCacheRedis,
} from "./repositories/redis/redis.tenant-organization-cache.repository.ts";
import { BillableEventsQueryService } from "./services/billable-events-query.service.ts";
import {
  DeploymentPlanSourcesService,
  type DeploymentPlanSources,
  type DeploymentPlanSourcesOptions,
} from "./services/deployment-plan-sources.service.ts";
import { BillingTenantOrganizationService } from "./services/tenant-organization.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "./services/usage-reporting.service.ts";

/** The billable-events totals a reporting run reads, over the process's own endpoints. */
export function createBillableEventsQuery(options: {
  resolveClient: BillingClickHouseClientResolver;
  resolveOrganizationClient: BillingClickHouseClientResolver;
}): BillableEventsQueryService {
  return BillableEventsQueryService.create(ClickhouseClickHouseRepository.create(options).build());
}

/** Where a billable event is metered, over the process's own tenant-keyed endpoint. */
export function createBillableEventsMeter(options: {
  resolveClient: BillableEventsMeterClickHouseClientResolver;
}): BillableEventsMeter {
  return BillableEventsMeterClickHouseRepository.create(options);
}

/** The organization cache a reporting run reads, over the process's own Redis. */
export function createBillingOrganizationCache(options: {
  redis: BillingOrganizationCacheRedis;
}): BillingOrganizationCache {
  return RedisBillingOrganizationCacheRepository.create(options);
}

/** Tenant-to-organization resolution, cached on the process's own Redis. */
export function createBillingTenantOrganizations(options: {
  organizations: BillingTenantOrganization;
  redis: BillingTenantOrganizationCacheRedis;
}): BillingTenantOrganizationService {
  return BillingTenantOrganizationService.create({
    organizations: options.organizations,
    cache: RedisTenantOrganizationCacheRepository.create({ redis: options.redis }),
  });
}

/**
 * The meter Stripe usage is reported to. Refuses a deployment with no Stripe
 * key, exactly as the builder does — a caller with no key does not ask.
 */
export function createStripeUsageReporting(options: {
  secretKey: string | undefined;
  nodeEnvironment: string | undefined;
}): UsageReportingService {
  return StripeUsageReportingBuilder.create(options).build();
}

/** The plan legs this deployment resolves a tier from, in their fixed order. */
export function createDeploymentPlanSources(
  options: DeploymentPlanSourcesOptions,
): DeploymentPlanSources {
  return DeploymentPlanSourcesService.create(options).sources();
}
