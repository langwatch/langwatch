/**
 * The three declared transports, and the facts two of them ask the process to
 * resolve. A mount binds a fact; nothing else may.
 */
export {
  BillingStripeWebhookApi,
  billingStripeWebhookRest,
} from "./transport/billing-stripe-webhook.rest.ts";
export {
  BillingCurrencyApi,
  currencyRequestHeadersFact,
  currencyTrpcTransport,
} from "./transport/currency.trpc.ts";
export {
  billingCallerEmailFact,
  BillingSubscriptionApi,
  subscriptionTrpcTransport,
  type BillingSubscriber,
} from "./transport/subscription.trpc.ts";
export { StripeErrorAdapter } from "./adapters/stripe-error.stripe-error.adapter.ts";
export {
  ClickhouseClickHouseRepository as ClickHouseBillingAdapter,
  type BillingClickHouseClientResolver,
} from "./repositories/clickhouse/clickhouse.clickhouse.repository.ts";
export type { BillableEventsClickHouseClient } from "./repositories/clickhouse/clickhouse.billable-events.repository.ts";
export {
  PrismaPostgresRepository as PostgresBillingAdapter,
  type PostgresBillingPersistence,
} from "./repositories/prisma/prisma.postgres.repository.ts";
export { StripeErrorTranslatorPort } from "./ports/stripe-error-translator.port.ts";
export { BillingCheckpointPort, type BillingCheckpoint } from "./ports/billing-checkpoint.port.ts";
export {
  BILLING_ORG_CACHE_PREFIX,
  BILLING_ORG_CACHE_TTL_MS,
  EventingReportUsageForMonthAdapter,
  type BillingOrganizationCache,
  type ReportUsageForMonthCommandDeps,
} from "./adapters/eventing.report-usage-for-month.adapter.ts";
export {
  BillingReportOrganizationPort,
  type BillingReportOrganization,
} from "./ports/billing-report-organization.port.ts";
export type { BillingCheckpointDatabase } from "./repositories/prisma/prisma.billing-checkpoint.repository.ts";
export type { BillingReportOrganizationDatabase } from "./repositories/prisma/prisma.billing-report-organization.repository.ts";
export {
  RedisBillingOrganizationCacheRepository as RedisBillingOrganizationCacheAdapter,
  type BillingOrganizationCacheRedis,
} from "./repositories/redis/redis.billing-organization-cache.repository.ts";
export {
  StripeUsageReportingAdapter,
  StripeUsageReportingUnavailable,
} from "./adapters/stripe.usage-reporting.adapter.ts";
export { ObservabilityBillingErrorAdapter } from "./adapters/observability.billing-error.adapter.ts";
export { EventingBillingReportingAdapter } from "./adapters/eventing.billing-reporting.adapter.ts";
export { BillingErrorReporterPort, NullBillingErrorReporter } from "./ports/error-reporter.port.ts";
export { BillingOrganizationPort } from "./ports/organization.port.ts";
export { NullBillingOrganizationAdapter } from "./adapters/null-organization.adapter.ts";
export { BillingSubscriptionNotifierPort } from "./ports/subscription-notifier.port.ts";
export { NullBillingSubscriptionNotifierAdapter } from "./adapters/null-subscription-notifier.adapter.ts";
export { NullUsageLimitEmailAdapter, UsageLimitEmailPort } from "./ports/usage-limit-email.port.ts";
export { BillableEventsRepository as BillableEventsPort, type BillableEventsWindow } from "./repositories/billable-events.repository.ts";
export {
  BillableEventsMeterPort,
  type BillableEventRecord,
} from "./ports/billable-events-meter.port.ts";
export {
  BillableEventsMeterClickHouseRepository,
  type BillableEventsMeterClickHouseClient,
  type BillableEventsMeterClickHouseClientResolver,
} from "./repositories/clickhouse/clickhouse.billable-events-meter.repository.ts";
export {
  BILLABLE_EVENTS_METER_PROJECTION_NAME,
  EventingBillableEventsMeterAdapter,
} from "./adapters/eventing.billable-events-meter.adapter.ts";
export {
  BILLING_METER_DISPATCH_SUBSCRIBER_NAME,
  BILLING_METER_DISPATCH_SUPPRESS_MS,
  EventingBillingMeterDispatchAdapter,
} from "./adapters/eventing.billing-meter-dispatch.adapter.ts";
export { BillingTenantOrganizationPort } from "./ports/tenant-organization.port.ts";
export {
  BillingTenantOrganizationService,
  type BillingTenantOrganizationCache,
} from "./services/tenant-organization.service.ts";
export {
  BILLING_TENANT_ORGANIZATION_CACHE_PREFIX,
  BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS,
  RedisTenantOrganizationCacheRepository as RedisBillingTenantOrganizationCacheAdapter,
  type BillingTenantOrganizationCacheRedis,
} from "./repositories/redis/redis.tenant-organization-cache.repository.ts";
export type { BillingTenantOrganizationDatabase } from "./repositories/prisma/prisma.tenant-organization.repository.ts";
export { PlanLimitsPlanCatalogueAdapter } from "./adapters/plan-limits.plan-catalogue.adapter.ts";
export { OrganizationPricingPort } from "./ports/organization-pricing.port.ts";
export { SubscriptionRepository as BillingSubscriptionPort } from "./repositories/subscription.repository.ts";
export {
  ANNUAL_EVENTS_BILLING_THRESHOLD,
  AnnualEventsBillingThresholdService,
} from "./services/annual-events-billing-threshold.service.ts";
export { BestEffortService } from "./services/best-effort.service.ts";
export { BillableEventsQueryService } from "./services/billable-events-query.service.ts";
export {
  CurrencyService,
  EUR_COUNTRIES,
  type CurrencyRequest,
} from "./services/currency.service.ts";
export { CustomerService } from "./services/customer.service.ts";
export {
  planLimitCooldown,
  planLimitInFlight,
  resourceLimitCooldown,
  type BillingCooldownCache,
} from "./services/billing-alert-cooldown.service.ts";
export { UsageLimitService } from "./services/usage-limit.service.ts";
export { UsageWarningService } from "./services/usage-warning.service.ts";
export type {
  BillingNextStepResolver,
  BillingUsageUnit,
} from "./rules/usage-warning-thresholds.rules.ts";
export {
  BillingSubscriptionService,
  RECENT_INVOICES_LIMIT,
} from "./services/subscription.service.ts";
export {
  LicensePurchaseService,
  LicenseGenerator,
  LicensePurchaseDelivery,
  type GeneratedLicense,
  type LicenseEmailDelivery,
  type LicenseFeaturesResolver,
  type LicensePurchaseNotification,
  type LicenseUnlockedFeatures,
} from "./services/license-purchase.service.ts";
export {
  NotificationService,
  type UsageLimitEmailData,
} from "./services/billing-usage-notice.service.ts";
export { NurturingService, type NurturingServiceOptions } from "./services/nurturing.service.ts";
export {
  NUMERIC_OVERRIDE_FIELDS,
  SaaSPlanProviderService,
} from "./services/plan-provider.service.ts";
export {
  DeploymentPlanSourcesService,
  type DeploymentPlanSources,
  type DeploymentPlanSourcesOptions,
} from "./services/deployment-plan-sources.service.ts";
export { SeatEventSubscriptionService } from "./services/seat-event-subscription.service.ts";
export { SeatSyncService } from "./services/seat-sync.service.ts";
export {
  StripeCustomerCurrencyService,
  type CheckoutCurrencyResolution,
} from "./services/stripe-customer-currency.service.ts";
export {
  SubscriptionItemCalculatorService,
  type SubscriptionItemUpdate,
} from "./services/subscription-item-calculator.service.ts";
export {
  StripeUsageReportingService,
  type UsageReportingService,
  type MeterEventResult,
  type UsageSummary,
} from "./services/usage-reporting.service.ts";

// The Stripe webhook and the Customer.io lifecycle signals, moved off
// `platform/app/src/server/app-layer/billing/`.
export {
  EEWebhookService,
  type HandleEventResult,
  type LicensePurchaseHandler,
  type WebhookService,
} from "./services/billing-stripe-webhook.service.ts";
export type { InviteApprover } from "./services/billing-checkout-completion.service.ts";
export {
  createBillingStripeClient,
  STRIPE_API_VERSION,
} from "./adapters/stripe.stripe-client.adapter.ts";
export { BillingWebhookOrganizationPort } from "./repositories/billing-webhook-organization.repository.ts";
export type { BillingWebhookOrganizationDatabase } from "./repositories/prisma/prisma.billing-webhook-organization.repository.ts";
export type { BillingWebhookTrialLicenseDatabase } from "./repositories/prisma/prisma.billing-webhook-subscription.repository.ts";
export {
  BillingWebhookHostPort,
  SilentBillingWebhookHost,
} from "./ports/billing-webhook-host.port.ts";
export {
  BillingWebhookSubscriptionPort,
  NullBillingWebhookSubscriptionAdapter,
  type CancelledSubscription,
  type SubscriptionWithOrg,
} from "./repositories/billing-webhook-subscription.repository.ts";
export { NurturingSinkRegistryService } from "./services/nurturing-sink-registry.service.ts";
export { PrismaNurturingProfileRepository } from "./repositories/prisma/prisma.nurturing-profile.repository.ts";
export type {
  NurturingProfile,
  NurturingProfileRepository,
} from "./repositories/nurturing-profile.repository.ts";
export { NurturingActivityTrackingService } from "./services/nurturing-activity-tracking.service.ts";
export { NurturingFeatureAdoptionService } from "./services/nurturing-feature-adoption.service.ts";
export {
  NurturingProductInterestService,
  type IntegrationMethodValue,
} from "./services/nurturing-product-interest.service.ts";
export { NurturingPromptCreationService } from "./services/nurturing-prompt-creation.service.ts";
export { NurturingSignupIdentificationService } from "./services/nurturing-signup-identification.service.ts";
export { NurturingSsoAutoAddService } from "./services/nurturing-sso-auto-add.service.ts";
export { NurturingSubscriptionSyncService } from "./services/nurturing-subscription-sync.service.ts";
export { NurturingUserSyncService } from "./services/nurturing-user-sync.service.ts";
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
export type {
  DuplicateSubscriptionsReportRepository,
  SubscriptionReportRow,
} from "./repositories/duplicate-subscriptions-report.repository.ts";

// The rows this module owns, and the two tiers behind them. A process selects
// one tier and is handed every row; it constructs no repository itself.
export type { BillingRepositories } from "./repositories/billing.repositories.ts";
export { billingRepositories } from "./repositories/billing-repositories.registry.ts";
export { MemoryBillingRepositories } from "./repositories/memory/memory.billing.repositories.ts";
export { MemoryBillingStore } from "./repositories/memory/memory-billing.store.ts";
export { PostgresBillingRepositories } from "./repositories/prisma/prisma.billing.repositories.ts";
