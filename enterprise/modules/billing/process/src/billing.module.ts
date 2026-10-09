import type { BillingApi, BillingServerConfig } from "@langwatch/enterprise-billing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

/**
 * What a process composes billing's process-side work from: the
 * Redis and Stripe substrates it already holds. Everything
 * behind these stays private — composition states substrates, never classes.
 */
import { BillingModule } from "./app/billing.app.ts";
import { billingChannels } from "./channels/billing-channels.registry.ts";
import { composeHttpBillingStripe } from "./channels/http/http.billing-stripe.channels.ts";
import { billingLifecycleEventing } from "./eventing/billing-lifecycle.pipeline.ts";
import { billingReportingEventing } from "./eventing/billing-reporting.pipeline.ts";
import { connectedBillingEventing } from "./eventing/connected-billing.pipeline.ts";
import type { BillingOrganizationCacheRepository } from "./repositories/billing-organization-cache.repository.ts";
import { billingRepositories } from "./repositories/billing-repositories.registry.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "./repositories/redis/redis.billing-organization-cache.repository.ts";
import { UsageBillingBackfillService } from "./services/usage-billing-backfill.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "./services/usage-reporting.service.ts";
import { detectEnvironment, StripePricesSyncTask } from "./tasks/stripe-prices-sync.task.ts";
import { TieredFreeToSeatEventMigrateTask } from "./tasks/tiered-free-to-seat-event.task.ts";
import { billingStripeWebhookRest } from "./transport/billing-stripe-webhook.rest.ts";
import { connectedBillingTrpcTransport } from "./transport/connected-billing.trpc.ts";
import { currencyTrpcTransport } from "./transport/currency.trpc.ts";
import { subscriptionTrpcTransport } from "./transport/subscription.trpc.ts";

/**
 * Billing as an installed module: the connected-billing, currency and subscription
 * doors and the Stripe callback; the factories below serve today's callers.
 */
export const billingProcessModule: PublishedProcessModule<
  "billing",
  BillingApi,
  BillingServerConfig
> = defineProcessModule("billing")
  .withRepositories(billingRepositories)
  .withChannels(billingChannels)
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
  // Background, after old writers are gone: an older image records no usage-billed fact.
  .withMigrations(({ app, repositories }) => [
    defineMigrationStep({
      id: "billing:record-usage-billing-catch-up",
      kind: "data",
      mode: "background",
      description:
        "Records whether the meter bills each organisation, the fact the Instant Evals judge folds.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterOrganizationId;
        const backfill = UsageBillingBackfillService.create({
          peers: {
            organizations: repositories.organizations,
            catchUp: (input) => app.catchUpUsageBilling(input),
          },
        });
        const report = await backfill.backfill({
          after: typeof resumed === "string" ? resumed : undefined,
          dryRun,
          signal,
          onPage: (page) => checkpoint.save({ report: page }),
        });
        return { ...report, dryRun };
      },
    }),
  ])
  .withTasks(async ({ app, repositories, secrets, config }) => [
    TieredFreeToSeatEventMigrateTask.create({
      peers: {
        organizations: repositories.organizations,
        subscriptions: repositories.subscriptions,
      },
      facts: { pricingModelChanged: (input) => app.pricingModelChanged(input) },
    }),
    await secrets.into(BillingModule.secrets.stripeSecretKey, (secretKey) =>
      StripePricesSyncTask.create({
        source: () => {
          if (!secretKey) return void 0;
          const { prices, meters } = composeHttpBillingStripe({
            secretKey,
            nodeEnvironment: config.nodeEnvironment,
          });
          return { environment: detectEnvironment(secretKey), prices, meters };
        },
      }),
    ),
  ]);

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
  const { secretKey, nodeEnvironment } = options;
  return StripeUsageReportingBuilder.create({
    meters: secretKey ? composeHttpBillingStripe({ secretKey, nodeEnvironment }).meters : void 0,
    nodeEnvironment,
  }).build();
}
