import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { defineProcessModule, instantiateRepositories } from "@langwatch/process";

/**
 * What a process composes billing's process-side work from: the
 * ClickHouse, Redis and Stripe substrates it already holds. Everything
 * behind these stays private — composition states substrates, never classes.
 */
import { BillingModule } from "./app/billing.app.ts";
import { billingLifecycleEventing } from "./eventing/billing-lifecycle.pipeline.ts";
import { billingReportingEventing } from "./eventing/billing-reporting.pipeline.ts";
import { connectedBillingEventing } from "./eventing/connected-billing.pipeline.ts";
import type { BillingOrganizationCacheRepository } from "./repositories/billing-organization-cache.repository.ts";
import {
  billingClickhouseRepositories,
  billingRepositories,
} from "./repositories/billing-repositories.registry.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "./repositories/redis/redis.billing-organization-cache.repository.ts";
import { BillableEventsQueryService } from "./services/billable-events-query.service.ts";
import {
  DeploymentPlanSourcesService,
  type DeploymentPlanSources,
  type DeploymentPlanSourcesOptions,
} from "./services/deployment-plan-sources.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "./services/usage-reporting.service.ts";
import { StripePricesSyncTask } from "./tasks/stripe-prices-sync.task.ts";
import { billingStripeWebhookRest } from "./transport/billing-stripe-webhook.rest.ts";
import { connectedBillingTrpcTransport } from "./transport/connected-billing.trpc.ts";
import { currencyTrpcTransport } from "./transport/currency.trpc.ts";
import { subscriptionTrpcTransport } from "./transport/subscription.trpc.ts";

/**
 * Billing as an installed module: the connected-billing, currency and subscription
 * doors and the Stripe callback; the factories below serve today's callers.
 */
export const billingProcessModule = defineProcessModule("billing")
  .withRepositories(billingRepositories)
  .withApi(BillingModule)
  .withTransports(
    connectedBillingTrpcTransport,
    billingStripeWebhookRest,
    currencyTrpcTransport,
    subscriptionTrpcTransport,
  )
  .withEventing(connectedBillingEventing)
  .withEventing(billingReportingEventing)
  .withEventing(billingLifecycleEventing)
  .withTasks(async ({ secrets }) => [
    await secrets.into(BillingModule.secrets.stripeSecretKey, (secretKey) =>
      StripePricesSyncTask.create({ secretKey: () => secretKey }),
    ),
  ]);

/** The billable-events totals a reporting run reads, over the process's own endpoints. */
export function createBillableEventsQuery(options: {
  clickhouse: ClickHouseQueryClient;
}): BillableEventsQueryService {
  return BillableEventsQueryService.create(
    liveClickhouseRepositories(options.clickhouse).billableEvents,
  );
}

function liveClickhouseRepositories(clickhouse: ClickHouseQueryClient) {
  return instantiateRepositories(billingClickhouseRepositories, {
    tier: "live",
    members: { clickhouse },
  });
}

/** The organization cache a reporting run reads, over the process's own Redis. */
export function createBillingOrganizationCache(options: {
  redis: BillingOrganizationCacheRedis;
}): BillingOrganizationCacheRepository {
  return RedisBillingOrganizationCacheRepository.create(options);
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
