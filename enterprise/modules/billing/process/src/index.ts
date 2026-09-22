/**
 * The three declared transports, and the facts two of them ask the process to
 * resolve. A mount binds a fact; nothing else may.
 */
export { createBillableEventsMeterProjection } from "./billing.server.ts";
export {
  type BillingStripeWebhookApi,
  billingStripeWebhookRest,
} from "./transport/billing-stripe-webhook.rest.ts";
export {
  type BillingCurrencyApi,
  currencyRequestHeadersFact,
  currencyTrpcTransport,
} from "./transport/currency.trpc.ts";
export {
  billingCallerEmailFact,
  type BillingSubscriptionApi,
  subscriptionTrpcTransport,
  type BillingSubscriber,
} from "./transport/subscription.trpc.ts";
export type { PostgresBillingPersistence } from "./repositories/prisma/prisma.postgres.repository.ts";
export type { BillingCheckpoint } from "./repositories/billing-checkpoint.repository.ts";
export type { BillingOrganizationCache } from "./repositories/organization/billing-organization-cache.repository.ts";
export {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "./eventing/report-usage-for-month.commands.ts";
export type { BillingReportOrganization } from "./repositories/organization/billing-report-organization.repository.ts";
export type { BillingCheckpointDatabase } from "./repositories/prisma/prisma.billing-checkpoint.repository.ts";
export type { BillingReportOrganizationDatabase } from "./repositories/prisma/prisma.billing-report-organization.repository.ts";
export type { BillingOrganizationCacheRedis } from "./repositories/redis/redis.billing-organization-cache.repository.ts";
export { BillingReportingPipeline } from "./eventing/billing-reporting.pipeline.ts";
export { BillingSubscriptionNotifier } from "./channels/billing-subscription-notifier.channel.ts";
export { MemoryBillingSubscriptionNotifierChannel } from "./channels/memory/memory.billing-subscription-notifier.channel.ts";
export { billingSubscriptionNotifierChannels } from "./channels/billing-subscription-notifier-channels.registry.ts";
export { UsageLimitEmailChannel } from "./channels/usage-limit-email.channel.ts";
export { MemoryUsageLimitEmailChannel } from "./channels/memory/memory.usage-limit-email.channel.ts";
export { usageLimitEmailChannels } from "./channels/usage-limit-email-channels.registry.ts";
export type { BillableEventsWindow } from "./repositories/billable-events.repository.ts";
export type {
  BillableEventRecord,
  BillableEventsMeter,
} from "./repositories/billable-events-meter.repository.ts";
export type { TenantOrganizationRepository } from "./repositories/tenant-organization.repository.ts";
/**
 * What a process composes billing's process-side work from. The repositories
 * and services behind these stay private to this feature server.
 */
export {
  createBillableEventsMeter,
  createBillableEventsQuery,
  createBillingOrganizationCache,
  createBillingTenantOrganizations,
  createDeploymentPlanSources,
  createStripeUsageReporting,
} from "./billing.server.ts";
export { BILLABLE_EVENTS_METER_PROJECTION_NAME } from "./eventing/billable-events-meter.projection.ts";
export {
  BILLING_METER_DISPATCH_SUBSCRIBER_NAME,
  BILLING_METER_DISPATCH_SUPPRESS_MS,
  BillingMeterDispatchSubscriber,
} from "./eventing/billing-meter-dispatch.subscriber.ts";
export type { BillingTenantOrganizationCache } from "./services/tenant-organization.service.ts";
export {
  BILLING_TENANT_ORGANIZATION_CACHE_PREFIX,
  BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS,
  type BillingTenantOrganizationCacheRedis,
} from "./repositories/redis/redis.tenant-organization-cache.repository.ts";
export type { BillingTenantOrganizationDatabase } from "./repositories/prisma/prisma.tenant-organization.repository.ts";
export type { BillingSubscription } from "./repositories/subscription.repository.ts";
export type { CurrencyRequest } from "./services/currency.service.ts";
export type { BillingCooldownCache } from "./services/billing-alert-cooldown.service.ts";
export type {
  BillingNextStepResolver,
  BillingUsageUnit,
} from "./rules/usage-warning-thresholds.rules.ts";
export type {
  GeneratedLicense,
  LicenseEmailDelivery,
  LicenseFeaturesResolver,
  LicensePurchaseNotification,
  LicenseUnlockedFeatures,
} from "./services/license-purchase.service.ts";
export type { UsageLimitEmailData } from "./services/billing-usage-notice.service.ts";
export type { NurturingServiceOptions } from "./services/nurturing.service.ts";
export type {
  DeploymentPlanSources,
  DeploymentPlanSourcesOptions,
} from "./services/deployment-plan-sources.service.ts";
export type { CheckoutCurrencyResolution } from "./services/stripe-customer-currency.service.ts";
export type { SubscriptionItemUpdate } from "./services/subscription-item-calculator.service.ts";
export type {
  UsageReportingService,
  MeterEventResult,
  UsageSummary,
} from "./services/usage-reporting.service.ts";

// The Stripe webhook and the Customer.io lifecycle signals, moved off
// `platform/app/src/server/app-layer/billing/`.
export type {
  HandleEventResult,
  LicensePurchaseHandler,
  WebhookService,
} from "./services/billing-stripe-webhook.service.ts";
export type { InviteApprover } from "./services/billing-checkout-completion.service.ts";
export type { BillingWebhookOrganizationDatabase } from "./repositories/prisma/prisma.billing-webhook-organization.repository.ts";
export type { BillingWebhookTrialLicenseDatabase } from "./repositories/prisma/prisma.billing-webhook-subscription.repository.ts";
export { BillingWebhookHost } from "./channels/billing-webhook-host.channel.ts";
export { MemoryBillingWebhookHostChannel } from "./channels/memory/memory.billing-webhook-host.channel.ts";
export { billingWebhookHostChannels } from "./channels/billing-webhook-host-channels.registry.ts";
export type {
  CancelledSubscription,
  SubscriptionWithOrg,
} from "./repositories/billing-webhook-subscription.repository.ts";
export type { NurturingProfile } from "./repositories/nurturing-profile.repository.ts";
export type { IntegrationMethodValue } from "./rules/nurturing-product-interest-service.rules.ts";
export {
  runTieredFreeToSeatEventMigration,
  TieredFreeToSeatEventMigrateTask,
  type TieredFreeToSeatEventMigrationDatabase,
  type TieredFreeToSeatEventMigrationOutcome,
} from "./tasks/tiered-free-to-seat-event.task.ts";
export {
  StripePricesSyncTask,
  syncStripePrices,
  type SyncStripePricesResult,
} from "./tasks/stripe-prices-sync.task.ts";
export {
  DuplicateSubscriptionsReportTask,
  reportDuplicateSubscriptions,
  type DuplicateSubscriptionsReport,
} from "./tasks/duplicate-subscriptions-report.task.ts";
export type { SubscriptionReportRow } from "./repositories/duplicate-subscriptions-report.repository.ts";
export {
  createScenarioRunMilestonesSubscriber,
  type ScenarioRunMilestonesSubscriberDeps,
} from "./eventing/scenario-run-milestones.subscriber.ts";
export { isConnectedAgentRunSucceeded } from "./rules/scenario-run-milestones.rules.ts";
export {
  ProjectActiveDayTrackerService,
  type ProjectActiveDayTrackerDeps,
  type ProjectActiveDaySource,
  type ProjectAdminResolution,
} from "./services/project-active-day-tracker.service.ts";
export { ProjectActiveDayRepository } from "./repositories/project-active-day.repository.ts";
export { MemoryProjectActiveDayRepository } from "./repositories/memory/memory.project-active-day.repository.ts";
export { PostHogChannel, type PostHogEventInput } from "./channels/posthog.channel.ts";
export { HttpPostHogChannel } from "./channels/http/http.posthog.channel.ts";
export { MemoryPostHogChannel } from "./channels/memory/memory.posthog.channel.ts";
export { postHogChannels } from "./channels/posthog-channels.registry.ts";

// The rows this module owns, and the two tiers behind them. A process selects
// one tier and is handed every row; it constructs no repository itself.
export type { BillingRepositories } from "./repositories/billing.repositories.ts";
export type { BillingClickHouseRepositories } from "./repositories/billing.repositories.ts";
export type { PostgresBillingRepositories } from "./repositories/prisma/prisma.billing.repositories.ts";
