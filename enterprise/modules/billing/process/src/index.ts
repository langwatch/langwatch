/**
 * The three declared transports, and the facts two of them ask the process to
 * resolve. A mount binds a fact; nothing else may.
 */
export { billingProcessModule } from "./billing.module.ts";
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
export type { BillingCheckpoint } from "./repositories/billing-checkpoint.repository.ts";
export type { BillingOrganizationCacheRepository } from "./repositories/billing-organization-cache.repository.ts";
export {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "./eventing/report-usage-for-month.commands.ts";
export type { BillingReportOrganization } from "./repositories/billing-report-organization.repository.ts";
export type { BillingOrganizationCacheRedis } from "./repositories/redis/redis.billing-organization-cache.repository.ts";
export { BillingSubscriptionNotifier } from "./channels/billing-subscription-notifier.channel.ts";
export { billingSubscriptionNotifierChannels } from "./channels/billing-subscription-notifier-channels.registry.ts";
export { UsageLimitEmailChannel } from "./channels/usage-limit-email.channel.ts";
export { usageLimitEmailChannels } from "./channels/usage-limit-email-channels.registry.ts";
export {
  ConnectedInvoicingChannel,
  type ConnectedInvoiceLine,
  type ProviderInvoice,
} from "./channels/connected-invoicing.channel.ts";
export { connectedInvoicingChannels } from "./channels/connected-invoicing-channels.registry.ts";
export type {
  ConnectedBillingAccountRecord,
  ConnectedCreditGrantRecord,
  ConnectedInvoiceRecord,
  ConnectedSeatChangeRecord,
  PendingRenewal,
} from "./repositories/connected-billing.repository.ts";
export type { ConnectedBillingTerms } from "./features/connected-billing/services/connected-billing.service.ts";
export type {
  CommitDrawdown,
  ConnectedCustomer,
  ConnectedStatement,
  ConnectedStatementSources,
  MonthlyStatementRunSummary,
  StatementSeats,
  StatementSpendLine,
} from "./features/connected-billing/services/connected-monthly-statement.service.ts";
export { ConnectedStatementMailChannel } from "./channels/connected-statement-mail.channel.ts";
export { connectedStatementMailChannels } from "./channels/connected-statement-mail-channels.registry.ts";
/**
 * What a process composes billing's process-side work from. The repositories
 * and services behind these stay private to this feature server.
 */
export { createBillingOrganizationCache, createStripeUsageReporting } from "./billing.module.ts";
export type { BillingSubscriptionRepository } from "./repositories/subscription.repository.ts";
export type { BillingCooldownCache } from "./services/billing-alert-cooldown.service.ts";
export type {
  GeneratedLicense,
  LicenseEmailDelivery,
  LicenseFeaturesResolver,
  LicensePurchaseNotification,
  LicenseUnlockedFeatures,
} from "./features/license-purchase/services/license-purchase.service.ts";
export type { UsageLimitEmailData } from "./services/billing-usage-notice.service.ts";
export type { CheckoutCurrencyResolution } from "./services/stripe-customer-currency.service.ts";
export type { SubscriptionItemUpdate } from "./rules/billing-stripe-shapes.rules.ts";
export type {
  UsageReportingService,
  MeterEventResult,
  UsageSummary,
} from "./services/usage-reporting.service.ts";

// The Stripe webhook, moved off
// `platform/app/src/server/app-layer/billing/`.
export { BillingWebhookHost } from "./channels/billing-webhook-host.channel.ts";
export { billingWebhookHostChannels } from "./channels/billing-webhook-host-channels.registry.ts";
export type {
  CancelledSubscription,
  SubscriptionWithOrg,
} from "./repositories/billing-webhook-subscription.repository.ts";
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
