# @langwatch/enterprise-billing-process

The server half of [billing](../README.md). Billing: subscriptions, invoices and invoice billing for connected self-hosted customers.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("billing").withRepositories(billingRepositories).withChannels(billingChannels).withApi(BillingModule).withTransports(connectedBillingTrpcTransport, billingStripeWebhookRest, currencyTrpcTransport, subscriptionTrpcTransport).withEventing(connectedBillingEventing).withEventing(billingReportingEventing).withEventing(billingLifecycleEventing).withEventing(seatLineRepairEventing).withEventing(paymentRecoveryEventing).withMigrations(…).withTasks(…)`, `src/billing.module.ts:45`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`BillingApi`)

What the billing module answers other modules: invoice billing for a connected self-hosted customer (ADR-156 section 7). Every operation refuses off LangWatch Cloud, and where no payment provider is configured. The admin console operations trust the platform door (Q43): staff only, writes need ops:manage.

Peers call these through the token, declared at `../contract/src/billing.api.ts:36`; nothing else in this package is public.

#### `getConnectedBillingOverview`

The commercial state of one connected customer.

```typescript
getConnectedBillingOverview(input: { organizationId: string }, staff: BillingStaff): Promise<ConnectedBillingOverview>;
```

#### `onboardConnectedCustomer`

Onboards a customer, or completes an onboarding that stopped halfway.

```typescript
onboardConnectedCustomer(input: ConnectedOnboardRequest, staff: BillingStaff): Promise<ConnectedBillingAccountView>;
```

#### `addConnectedCommit`

Raises the commit mid-term: a second paid credit, and the budget with it.

```typescript
addConnectedCommit(input: ConnectedAddCommitRequest, staff: BillingStaff): Promise<ConnectedCreditGrantView>;
```

#### `renewConnectedTerm`

```typescript
renewConnectedTerm(input: ConnectedRenewRequest, staff: BillingStaff): Promise<ConnectedBillingAccountView>;
```

#### `completeConnectedRenewalIfDue`

```typescript
completeConnectedRenewalIfDue(input: { organizationId: string }, staff: BillingStaff): Promise<RenewalCompletion>;
```

#### `markConnectedInvoicePaidOutOfBand`

Finance received the money outside the payment provider.

```typescript
markConnectedInvoicePaidOutOfBand(input: { stripeInvoiceId: string }, staff: BillingStaff): Promise<void>;
```

#### `invoicePendingSeatChanges`

One seat invoicing pass: decides every seat change licensing recorded that has no decision yet, then invoices every intended one. Cloud only.

```typescript
invoicePendingSeatChanges(): Promise<void>;
```

#### `runConnectedBillingTick`

The daily tick: monthly statements and due renewals. Cloud only.

```typescript
runConnectedBillingTick(): Promise<void>;
```

#### `getActiveSubscriptionPlan`

The plan an organization's active subscription grants on LangWatch Cloud, with the subscription's own limit overrides; the free plan where none is active or off Cloud.

```typescript
getActiveSubscriptionPlan(input: SubscriptionPlanInput): Promise<PlanInfo>;
```

#### `notifyResourceLimitReached`

Main's `usageLimits.notifyResourceLimitReached`: the ops Slack alert for a reached seat limit, SaaS only, at most once a day per organization and limit. Never throws.

```typescript
notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void>;
```

#### `notifySalesOfSeatRequest`

Tells sales that a person waits for a seat in an organization whose plan only sales can grow, on the subscriptions Slack channel. SaaS only; the caller sends it once per request. Never throws.

```typescript
notifySalesOfSeatRequest(input: { organizationId: string; organizationName: string; plan: string; seats: number; requestedSeats: number; }): Promise<void>;
```

#### `getPricingModel`

The organization's pricing model column, which is empty for organizations never migrated.

```typescript
getPricingModel(input: { organizationId: string; }): Promise<{ pricingModel: BillingPricingModel | null }>;
```

#### `createSeatCheckout`

Opens a seat checkout for `membersToAdd`, the customer resolved from `customerEmail`. Answers the pending subscription organization holds the checkout's invitations against (C2 A).

```typescript
createSeatCheckout(input: { organizationId: string; baseUrl: string; membersToAdd: number; currency?: Currency; billingInterval?: SubscriptionBillingInterval; customerEmail: string | null; retentionDays?: number; }): Promise<{ url: string | null; subscriptionId: string }>;
```

#### `recordRetentionStorage`

Bills the storage an organization keeps beyond the 90 days Growth includes: the metered line follows the longest retention, and a measurement goes to the meter as that day's share of a GB-month. Answers what it did; an organization with no Growth seat subscription is skipped.

```typescript
recordRetentionStorage(input: RetentionStorageReport): Promise<RetentionStorageOutcome>;
```

## REST transport

### `billingStripeWebhookRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/billing-stripe-webhook.rest.ts:32` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `POST /api/webhooks/stripe` · `receiveStripeWebhook`

Public: the provider signs every delivery and the signature is verified over the raw bytes by the route itself; no API credential opens this door. Declared at `src/transport/billing-stripe-webhook.rest.ts:37`.

Answers at `/api/webhooks/stripe`, `/api/v1/webhooks/stripe`.

```typescript
// Rawbody: "bytes" (inline, src/transport/billing-stripe-webhook.rest.ts:42)
type Headers = z.infer<typeof billingStripeWebhookHeadersSchema>; // ../contract/src/billing-types.ts:250
// Response: billingStripeWebhookReceiptSchema, ../contract/src/billing-types.ts:241
interface Response {
  received: true;
}
```

## tRPC transport

### `connectedBilling`

Contract `../contract/src/connected-billing.trpc.ts:21`, router `src/transport/connected-billing.trpc.ts:43`.

| Procedure                               | Kind     | Gate                             | Input                             | Output                              |
| --------------------------------------- | -------- | -------------------------------- | --------------------------------- | ----------------------------------- |
| `connectedBilling.get`                  | query    | Platform permission `ops:view`   | `connectedCustomerInputSchema`    | `connectedBillingOverviewSchema`    |
| `connectedBilling.onboard`              | mutation | Platform permission `ops:manage` | `connectedOnboardRequestSchema`   | `connectedBillingAccountViewSchema` |
| `connectedBilling.addCommit`            | mutation | Platform permission `ops:manage` | `connectedAddCommitRequestSchema` | `connectedCreditGrantViewSchema`    |
| `connectedBilling.renew`                | mutation | Platform permission `ops:manage` | `connectedRenewRequestSchema`     | `connectedBillingAccountViewSchema` |
| `connectedBilling.completeRenewalIfDue` | mutation | Platform permission `ops:manage` | `connectedCustomerInputSchema`    | `connectedRenewalOutcomeSchema`     |
| `connectedBilling.markPaidOutOfBand`    | mutation | Platform permission `ops:manage` | `connectedInvoiceTargetSchema`    | `connectedInvoiceTargetSchema`      |

```typescript
// connectedBilling.get
// Input: connectedCustomerInputSchema, ../contract/src/connected-billing.schemas.ts:20
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof connectedBillingOverviewSchema>; // ../contract/src/connected-billing.schemas.ts:182

// connectedBilling.onboard
type Input = z.infer<typeof connectedOnboardRequestSchema>; // ../contract/src/connected-billing.schemas.ts:48
type Output = z.infer<typeof connectedBillingAccountViewSchema>; // ../contract/src/connected-billing.schemas.ts:100

// connectedBilling.addCommit
// Input: connectedAddCommitRequestSchema, ../contract/src/connected-billing.schemas.ts:70
interface Input {
  organizationId: string;
  amountUsdCents: number;
}
// Output: connectedCreditGrantViewSchema, ../contract/src/connected-billing.schemas.ts:114
interface Output {
  stripeCreditGrantId: string;
  amountUsdCents: number;
  kind: "commit" | "added" | "renewal";
  termEndsAt: string;
  expiresAt: string;
}

// connectedBilling.renew
// Input: connectedRenewRequestSchema, ../contract/src/connected-billing.schemas.ts:59
interface Input {
  organizationId: string;
  termStartsAt: string;
  termEndsAt: string;
  seats: number;
  seatRateCents: number;
  seatCurrency: "USD" | "EUR";
  commitUsdCents: number;
}
type Output = z.infer<typeof connectedBillingAccountViewSchema>; // ../contract/src/connected-billing.schemas.ts:100

// connectedBilling.completeRenewalIfDue
type Input = z.infer<typeof connectedCustomerInputSchema>; // ../contract/src/connected-billing.schemas.ts:20
// Output: connectedRenewalOutcomeSchema, ../contract/src/connected-billing.schemas.ts:192
interface Output {
  outcome: "completed" | "waiting" | "none";
}

// connectedBilling.markPaidOutOfBand
// Input: connectedInvoiceTargetSchema, ../contract/src/connected-billing.schemas.ts:78
interface Input {
  stripeInvoiceId: string;
}
type Output = z.infer<typeof connectedInvoiceTargetSchema>; // ../contract/src/connected-billing.schemas.ts:78
```

### `currency`

Contract `../contract/src/currency.trpc.ts:22`, router `src/transport/currency.trpc.ts:47`.

| Procedure                 | Kind  | Gate                                                                                                                                     | Input                       | Output                   |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------ |
| `currency.detectCurrency` | query | No permission: answers which of the two currencies a reader's prices are shown in; public reference data, no scope id and no tenant read | `detectCurrencyInputSchema` | `detectedCurrencySchema` |

```typescript
// currency.detectCurrency
// Input: detectCurrencyInputSchema, ../contract/src/currency.trpc.ts:20
type Input = Record<string, unknown>;
// Output: detectedCurrencySchema, ../contract/src/pricing.ts:19
interface Output {
  currency: "USD" | "EUR";
  country: string | null;
}
```

### `subscription`

Contract `../contract/src/subscription.trpc.ts:42`, router `src/transport/subscription.trpc.ts:111`.

| Procedure                             | Kind     | Gate                              | Input                     | Output                           |
| ------------------------------------- | -------- | --------------------------------- | ------------------------- | -------------------------------- |
| `subscription.addTeamMemberOrEvents`  | mutation | Permission `subscription:manage`  | inline                    | `subscriptionItemsUpdatedSchema` |
| `subscription.create`                 | mutation | Permission `subscription:upgrade` | inline                    | `billingRedirectSchema`          |
| `subscription.manage`                 | mutation | Permission `subscription:manage`  | inline                    | `billingPortalSessionSchema`     |
| `subscription.previewProration`       | query    | Permission `subscription:manage`  | inline                    | `providerOwnedSchema`            |
| `subscription.getLastSubscription`    | query    | Permission `organization:view`    | `organizationScopeSchema` | `providerOwnedSchema`            |
| `subscription.prospective`            | mutation | Permission `subscription:manage`  | inline                    | `providerOwnedSchema`            |
| `subscription.developerSeats`         | query    | Permission `organization:view`    | `organizationScopeSchema` | `developerSeatsSchema`           |
| `subscription.previewDeveloperSeats`  | query    | Permission `organization:manage`  | inline                    | `developerSeatQuoteSchema`       |
| `subscription.setDeveloperSeats`      | mutation | Permission `organization:manage`  | inline                    | `subscriptionItemsUpdatedSchema` |
| `subscription.listInvoices`           | query    | Permission `subscription:manage`  | `organizationScopeSchema` | inline                           |
| `subscription.paymentRecovery`        | query    | Permission `organization:view`    | `organizationScopeSchema` | `paymentRecoverySummarySchema`   |
| `subscription.paymentRecoveryDetails` | query    | Permission `subscription:manage`  | `organizationScopeSchema` | `paymentRecoveryDetailsSchema`   |
| `subscription.paymentRecoveryPayLink` | mutation | Permission `subscription:manage`  | `organizationScopeSchema` | `paymentRecoveryPayLinkSchema`   |

```typescript
// subscription.addTeamMemberOrEvents
// Input: z.object({ ...organizationScopeSchema.shape, plan: subscribablePlanSchema, upgradeMembers… (inline, ../contract/src/subscription.trpc.ts:45)
// Output: subscriptionItemsUpdatedSchema, ../contract/src/billing-types.ts:234
interface Output {
  success: boolean;
}

// subscription.create
// Input: z.object({ ...organizationScopeSchema.shape, baseUrl: z.string(), plan: subscribablePlanS… (inline, ../contract/src/subscription.trpc.ts:62)
// Output: billingRedirectSchema, ../contract/src/billing-types.ts:218
interface Output {
  url: string | null;
}

// subscription.manage
// Input: inline, ../contract/src/subscription.trpc.ts:77
interface Input {
  organizationId: string;
  baseUrl: string;
}
// Output: billingPortalSessionSchema, ../contract/src/billing-types.ts:226
interface Output {
  url: string;
}

// subscription.previewProration
// Input: inline, ../contract/src/subscription.trpc.ts:81
interface Input {
  organizationId: string;
  newTotalSeats: number;
}
// Output: providerOwnedSchema, ../contract/src/subscription.trpc.ts:40
type Output = unknown;

// subscription.getLastSubscription
// Input: organizationScopeSchema, ../contract/src/subscription.trpc.ts:26
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof providerOwnedSchema>; // ../contract/src/subscription.trpc.ts:40

// subscription.prospective
// Input: z.object({ ...organizationScopeSchema.shape, plan: subscribablePlanSchema, customerName: … (inline, ../contract/src/subscription.trpc.ts:90)
type Output = z.infer<typeof providerOwnedSchema>; // ../contract/src/subscription.trpc.ts:40

// subscription.developerSeats
type Input = z.infer<typeof organizationScopeSchema>; // ../contract/src/subscription.trpc.ts:26
// Output: developerSeatsSchema, ../contract/src/billing-types.ts:294
interface Output {
  available: boolean;
  quantity: number;
  unitAmountCents: number | null;
  currency: string;
  billingInterval: string;
  periodEndsAt: number | null;
}

// subscription.previewDeveloperSeats
// Input: inline, ../contract/src/subscription.trpc.ts:107
interface Input {
  organizationId: string;
  quantity: number;
}
// Output: developerSeatQuoteSchema, ../contract/src/billing-types.ts:312
interface Output {
  amountDueCents: number;
  formattedAmountDue: string;
  taxCents: number;
  formattedRecurringTotal: string;
  billingInterval: string;
  quotedAt: number;
}

// subscription.setDeveloperSeats
// Input: inline, ../contract/src/subscription.trpc.ts:112
interface Input {
  organizationId: string;
  quantity: number;
  quotedAt?: number;
}
type Output = z.infer<typeof subscriptionItemsUpdatedSchema>; // ../contract/src/billing-types.ts:234

// subscription.listInvoices
type Input = z.infer<typeof organizationScopeSchema>; // ../contract/src/subscription.trpc.ts:26
// Output: inline, ../contract/src/subscription.trpc.ts:122
type Output = {
  id: string;
  number: string | null;
  date: number;
  amountDue: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}[];

// subscription.paymentRecovery
type Input = z.infer<typeof organizationScopeSchema>; // ../contract/src/subscription.trpc.ts:26
// Output: paymentRecoverySummarySchema, ../contract/src/payment-recovery.ts:18
interface Output {
  state: "none" | "failing" | "paused";
}

// subscription.paymentRecoveryDetails
type Input = z.infer<typeof organizationScopeSchema>; // ../contract/src/subscription.trpc.ts:26
// Output: paymentRecoveryDetailsSchema, ../contract/src/payment-recovery.ts:39
interface Output {
  state: "none" | "failing" | "paused";
  startedAt: string | null;
  accessStopsAt: string | null;
  invoiceNumber: string | null;
  amountDue: number | null;
  currency: string | null;
  card: {
    brand: string;
    last4: string;
  } | null;
}

// subscription.paymentRecoveryPayLink
type Input = z.infer<typeof organizationScopeSchema>; // ../contract/src/subscription.trpc.ts:26
// Output: paymentRecoveryPayLinkSchema, ../contract/src/payment-recovery.ts:52
interface Output {
  url: string;
  isFallback: boolean;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `billing_lifecycle` (aggregate `billing_lifecycle`)

Declared at `src/eventing/billing-lifecycle.pipeline.ts:89`. Events: `subscriptionChangedEventSchema`, `subscriptionStartedEventSchema`, `checkoutCompletedEventSchema`, `usageBillingChangedEventSchema`, `billingAuditRecordedEventSchema`, `planLimitAlertSentEventSchema`, `checkoutCurrencySelectedEventSchema`, `pricingModelChangedEventSchema`, `seatCheckoutPaidEventSchema`, `seatCheckoutsAbandonedEventSchema`, `overPlanChangedEventSchema`.

| Kind            | Name                             | Handles               | Declared at                                      |
| --------------- | -------------------------------- | --------------------- | ------------------------------------------------ |
| command         | `recordSubscriptionChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:106` |
| command         | `recordSubscriptionStarted`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:107` |
| command         | `recordCheckoutCompleted`        | –                     | `src/eventing/billing-lifecycle.pipeline.ts:108` |
| command         | `recordUsageBillingChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:109` |
| command         | `recordAudit`                    | –                     | `src/eventing/billing-lifecycle.pipeline.ts:110` |
| command         | `recordPlanLimitAlertSent`       | –                     | `src/eventing/billing-lifecycle.pipeline.ts:111` |
| command         | `recordCheckoutCurrencySelected` | –                     | `src/eventing/billing-lifecycle.pipeline.ts:112` |
| command         | `recordPricingModelChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:113` |
| command         | `recordSeatCheckoutPaid`         | –                     | `src/eventing/billing-lifecycle.pipeline.ts:114` |
| command         | `recordSeatCheckoutsAbandoned`   | –                     | `src/eventing/billing-lifecycle.pipeline.ts:115` |
| command         | `recordOverPlanChanged`          | –                     | `src/eventing/billing-lifecycle.pipeline.ts:116` |
| peer subscriber | `organizationSeatLimitReached`   | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:117` |
| peer subscriber | `usageLimitReached`              | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:121` |

### Pipeline `billing_reporting` (aggregate `billing_report`)

Declared at `src/eventing/billing-reporting.pipeline.ts:80`.

| Kind            | Name                    | Handles                                                                                                | Declared at                                      |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| command         | –                       | –                                                                                                      | `src/eventing/billing-reporting.pipeline.ts:87`  |
| peer subscriber | `usageMonthCounted`     | `lw.entitlement.month_counted` from [entitlement](../../../../modules/entitlement/README.md)           | `src/eventing/billing-reporting.pipeline.ts:101` |
| peer subscriber | `usageThresholdCrossed` | `lw.entitlement.usage_threshold_crossed` from [entitlement](../../../../modules/entitlement/README.md) | `src/eventing/billing-reporting.pipeline.ts:114` |

### Pipeline `connected_billing` (aggregate `connected_billing`)

Declared at `src/eventing/connected-billing.pipeline.ts:73`. Events: `connectedCustomerOnboardedEventSchema`, `connectedTermRenewedEventSchema`.

| Kind            | Name                               | Handles                                                                                   | Declared at                                     |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| command         | `recordConnectedCustomerOnboarded` | –                                                                                         | `src/eventing/connected-billing.pipeline.ts:78` |
| command         | `recordConnectedTermRenewed`       | –                                                                                         | `src/eventing/connected-billing.pipeline.ts:79` |
| process manager | `connectedBillingTick`             | every 5 min (`CONNECTED_BILLING_FIRST_DELAY_MS = 5 * 60 * 1000`); intents `tick` (outbox) | `src/eventing/connected-billing.pipeline.ts:80` |
| process manager | `seatInvoicing`                    | every 1 min (`SEAT_INVOICING_INTERVAL_MS = 60 * 1000`); intents `pass` (outbox)           | `src/eventing/connected-billing.pipeline.ts:97` |

### Pipeline `billing_payment_recovery` (aggregate `global`)

Declared at `src/eventing/payment-recovery.pipeline.ts:43`.

| Kind            | Name              | Handles                                                                               | Declared at                                    |
| --------------- | ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| process manager | `paymentRecovery` | every 1 h (`PAYMENT_RECOVERY_INTERVAL_MS = 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/payment-recovery.pipeline.ts:49` |

### Pipeline `billing_seat_line_repair` (aggregate `global`)

Declared at `src/eventing/seat-line-repair.pipeline.ts:40`.

| Kind            | Name             | Handles                                                                                   | Declared at                                    |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| process manager | `seatLineRepair` | every 15 min (`SEAT_LINE_REPAIR_INTERVAL_MS = 15 * 60 * 1000`); intents `repair` (outbox) | `src/eventing/seat-line-repair.pipeline.ts:46` |

### Tasks

Run by the tasks process, before serve.

| Task                        | Class                              | Declared at                                      |
| --------------------------- | ---------------------------------- | ------------------------------------------------ |
| `tiered-free-to-seat-event` | `TieredFreeToSeatEventMigrateTask` | `src/tasks/tiered-free-to-seat-event.task.ts:79` |
| `stripe-prices-sync`        | `StripePricesSyncTask`             | `src/tasks/stripe-prices-sync.task.ts:469`       |

## Configuration

| Kind   | Leaf                                | Environment variable                           | Declared at                            |
| ------ | ----------------------------------- | ---------------------------------------------- | -------------------------------------- |
| secret | `stripeSecretKey`                   | `STRIPE_SECRET_KEY`                            | `src/app/billing.app.ts:217`           |
| secret | `stripeWebhookSecret`               | `STRIPE_WEBHOOK_SECRET`                        | `src/app/billing.app.ts:218`           |
| secret | `internalSlackPlanLimitWebhook`     | `SLACK_PLAN_LIMIT_CHANNEL`                     | `src/app/billing.app.ts:219`           |
| secret | `internalSlackSubscriptionsWebhook` | `SLACK_CHANNEL_SUBSCRIPTIONS`                  | `src/app/billing.app.ts:220`           |
| secret | `internalSlackSelfHostedWebhook`    | `SLACK_CHANNEL_SELF_HOSTED`                    | `src/app/billing.app.ts:221`           |
| secret | `internalSlackSignupsWebhook`       | ≈ `billingSecrets.internalSlackSignupsWebhook` | `src/app/billing.app.ts:222`           |
| config | `licensePaymentLinkId`              | `STRIPE_LICENSE_PAYMENT_LINK_ID`               | `../contract/src/billing.config.ts:13` |
| config | `licensePaymentUrl`                 | `STRIPE_LICENSE_PAYMENT_LINK_URL`              | `../contract/src/billing.config.ts:15` |
| config | `hubspotPortalId`                   | `HUBSPOT_PORTAL_ID`                            | `../contract/src/billing.config.ts:23` |
| config | `hubspotFormId`                     | `HUBSPOT_FORM_ID`                              | `../contract/src/billing.config.ts:24` |
| config | `hubspotReachedLimitFormId`         | `HUBSPOT_REACHED_LIMIT_FORM_ID`                | `../contract/src/billing.config.ts:25` |
| config | `bankDetails`                       | `LANGWATCH_BILLING_BANK_DETAILS`               | `../contract/src/billing.config.ts:26` |
| config | `stripeApiBase`                     | `STRIPE_API_BASE`                              | `../contract/src/billing.config.ts:28` |
| config | `isSaas`                            | `IS_SAAS`                                      | `../contract/src/billing.config.ts:36` |
| config | `publicBaseUrl`                     | `BASE_HOST`                                    | `../contract/src/billing.config.ts:38` |
| config | `nodeEnvironment`                   | `NODE_ENV`                                     | `../contract/src/billing.config.ts:40` |

<!-- readme:generated:end -->
