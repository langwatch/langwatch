# @langwatch/enterprise-billing-process

The server half of [billing](../README.md). Billing: subscriptions, invoices and invoice billing for connected self-hosted customers.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("billing").withRepositories(billingRepositories).withApi(BillingModule).withTransports(connectedBillingTrpcTransport, billingStripeWebhookRest, currencyTrpcTransport, subscriptionTrpcTransport).withEventing(connectedBillingEventing).withEventing(billingReportingEventing).withEventing(billingLifecycleEventing).withTasks(…)`, `src/billing.module.ts:34`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`BillingApi`)

What the billing module answers other modules: invoice billing for a connected self-hosted customer (ADR-156 section 7). Every operation refuses off LangWatch Cloud, and where no payment provider is configured. The admin console operations trust the platform door (Q43): staff only, writes need ops:manage.

Peers call these through the token, declared at `../contract/src/billing.api.ts:37`; nothing else in this package is public.

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

#### `sendUsageWarning`

Mails the organization's admins the usage warning entitlement decided, once per threshold a month. Billing counts nothing: the threshold and per-project counts arrive decided.

```typescript
sendUsageWarning(input: UsageWarningDecision): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }>;
```

#### `notifyResourceLimitReached`

Main's `usageLimits.notifyResourceLimitReached`: the ops Slack alert for a reached seat limit, SaaS only, at most once a day per organization and limit. Never throws.

```typescript
notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void>;
```

#### `getPricingModel`

The organization's pricing model column, which is empty for organizations never migrated.

```typescript
getPricingModel(input: { organizationId: string; }): Promise<{ pricingModel: BillingPricingModel | null }>;
```

#### `createSeatCheckout`

Opens a seat checkout for `membersToAdd`, the customer resolved from `customerEmail`. Answers the pending subscription organization holds the checkout's invitations against (C2 A).

```typescript
createSeatCheckout(input: { organizationId: string; baseUrl: string; membersToAdd: number; currency?: Currency; billingInterval?: SubscriptionBillingInterval; customerEmail: string | null; }): Promise<{ url: string | null; subscriptionId: string }>;
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
// Rawbody: "bytes" (inline, src/transport/billing-stripe-webhook.rest.ts:40)
type Headers = z.infer<typeof billingStripeWebhookHeadersSchema>; // ../contract/src/billing-types.ts:227
type Response = z.infer<typeof billingStripeWebhookReceiptSchema>; // ../contract/src/billing-types.ts:225
```

## tRPC transport

### `connectedBilling`

Contract `../contract/src/connected-billing.trpc.ts:21`, router `src/transport/connected-billing.trpc.ts:39`.

| Procedure                               | Kind     | Gate                             | Input                             | Output                              |
| --------------------------------------- | -------- | -------------------------------- | --------------------------------- | ----------------------------------- |
| `connectedBilling.get`                  | query    | Platform permission `ops:view`   | `connectedCustomerInputSchema`    | `connectedBillingOverviewSchema`    |
| `connectedBilling.onboard`              | mutation | Platform permission `ops:manage` | `connectedOnboardRequestSchema`   | `connectedBillingAccountViewSchema` |
| `connectedBilling.addCommit`            | mutation | Platform permission `ops:manage` | `connectedAddCommitRequestSchema` | `connectedCreditGrantViewSchema`    |
| `connectedBilling.renew`                | mutation | Platform permission `ops:manage` | `connectedRenewRequestSchema`     | `connectedBillingAccountViewSchema` |
| `connectedBilling.completeRenewalIfDue` | mutation | Platform permission `ops:manage` | `connectedCustomerInputSchema`    | `connectedRenewalOutcomeSchema`     |
| `connectedBilling.markPaidOutOfBand`    | mutation | Platform permission `ops:manage` | `connectedInvoiceTargetSchema`    | `connectedInvoiceTargetSchema`      |

### `currency`

Contract `../contract/src/currency.trpc.ts:17`, router `src/transport/currency.trpc.ts:42`.

| Procedure                 | Kind  | Gate                                                                                                                                     | Input                       | Output                   |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------ |
| `currency.detectCurrency` | query | No permission: answers which of the two currencies a reader's prices are shown in; public reference data, no scope id and no tenant read | `detectCurrencyInputSchema` | `detectedCurrencySchema` |

### `subscription`

Contract `../contract/src/subscription.trpc.ts:34`, router `src/transport/subscription.trpc.ts:81`.

| Procedure                            | Kind     | Gate                             | Input                     | Output                           |
| ------------------------------------ | -------- | -------------------------------- | ------------------------- | -------------------------------- |
| `subscription.addTeamMemberOrEvents` | mutation | Permission `organization:manage` | inline                    | `subscriptionItemsUpdatedSchema` |
| `subscription.create`                | mutation | Permission `organization:manage` | inline                    | `billingRedirectSchema`          |
| `subscription.manage`                | mutation | Permission `organization:manage` | inline                    | `billingPortalSessionSchema`     |
| `subscription.previewProration`      | query    | Permission `organization:manage` | inline                    | `providerOwnedSchema`            |
| `subscription.getLastSubscription`   | query    | Permission `organization:view`   | `organizationScopeSchema` | `providerOwnedSchema`            |
| `subscription.prospective`           | mutation | Permission `organization:manage` | inline                    | `providerOwnedSchema`            |
| `subscription.listInvoices`          | query    | Permission `organization:view`   | `organizationScopeSchema` | inline                           |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `billing_lifecycle` (aggregate `billing_lifecycle`)

Declared at `src/eventing/billing-lifecycle.pipeline.ts:85`. Events: `subscriptionChangedEventSchema`, `subscriptionStartedEventSchema`, `checkoutCompletedEventSchema`, `usageBillingChangedEventSchema`, `billingAuditRecordedEventSchema`, `planLimitAlertSentEventSchema`, `checkoutCurrencySelectedEventSchema`, `pricingModelChangedEventSchema`, `seatCheckoutPaidEventSchema`, `seatCheckoutsAbandonedEventSchema`.

| Kind            | Name                             | Handles               | Declared at                                      |
| --------------- | -------------------------------- | --------------------- | ------------------------------------------------ |
| command         | `recordSubscriptionChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:101` |
| command         | `recordSubscriptionStarted`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:102` |
| command         | `recordCheckoutCompleted`        | –                     | `src/eventing/billing-lifecycle.pipeline.ts:103` |
| command         | `recordUsageBillingChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:104` |
| command         | `recordAudit`                    | –                     | `src/eventing/billing-lifecycle.pipeline.ts:105` |
| command         | `recordPlanLimitAlertSent`       | –                     | `src/eventing/billing-lifecycle.pipeline.ts:106` |
| command         | `recordCheckoutCurrencySelected` | –                     | `src/eventing/billing-lifecycle.pipeline.ts:107` |
| command         | `recordPricingModelChanged`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:108` |
| command         | `recordSeatCheckoutPaid`         | –                     | `src/eventing/billing-lifecycle.pipeline.ts:109` |
| command         | `recordSeatCheckoutsAbandoned`   | –                     | `src/eventing/billing-lifecycle.pipeline.ts:110` |
| peer subscriber | `organizationSeatLimitReached`   | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:111` |
| peer subscriber | `usageLimitReached`              | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:115` |

### Pipeline `billing_reporting` (aggregate `billing_report`)

Declared at `src/eventing/billing-reporting.pipeline.ts:72`.

| Kind            | Name                | Handles                                                                                      | Declared at                                     |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| command         | –                   | –                                                                                            | `src/eventing/billing-reporting.pipeline.ts:79` |
| peer subscriber | `usageMonthCounted` | `lw.entitlement.month_counted` from [entitlement](../../../../modules/entitlement/README.md) | `src/eventing/billing-reporting.pipeline.ts:93` |

### Pipeline `connected_billing` (aggregate `global`)

Declared at `src/eventing/connected-billing.pipeline.ts:52`.

| Kind            | Name                   | Handles                                                                                   | Declared at                                     |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| process manager | `connectedBillingTick` | every 5 min (`CONNECTED_BILLING_FIRST_DELAY_MS = 5 * 60 * 1000`); intents `tick` (outbox) | `src/eventing/connected-billing.pipeline.ts:57` |
| process manager | `seatInvoicing`        | every 1 min (`SEAT_INVOICING_INTERVAL_MS = 60 * 1000`); intents `pass` (outbox)           | `src/eventing/connected-billing.pipeline.ts:74` |

### Tasks

Run by the tasks process, before serve.

| Task                     | Class                     | Declared at                                   |
| ------------------------ | ------------------------- | --------------------------------------------- |
| `usage-billing-catch-up` | `UsageBillingCatchUpTask` | `src/tasks/usage-billing-catch-up.task.ts:24` |
| `stripe-prices-sync`     | `StripePricesSyncTask`    | `src/tasks/stripe-prices-sync.task.ts:467`    |

## Configuration

| Kind   | Leaf                                | Environment variable                           | Declared at                            |
| ------ | ----------------------------------- | ---------------------------------------------- | -------------------------------------- |
| secret | `stripeSecretKey`                   | `STRIPE_SECRET_KEY`                            | `src/app/billing.app.ts:186`           |
| secret | `stripeWebhookSecret`               | `STRIPE_WEBHOOK_SECRET`                        | `src/app/billing.app.ts:187`           |
| secret | `internalSlackPlanLimitWebhook`     | `SLACK_PLAN_LIMIT_CHANNEL`                     | `src/app/billing.app.ts:188`           |
| secret | `internalSlackSubscriptionsWebhook` | `SLACK_CHANNEL_SUBSCRIPTIONS`                  | `src/app/billing.app.ts:189`           |
| secret | `internalSlackSelfHostedWebhook`    | `SLACK_CHANNEL_SELF_HOSTED`                    | `src/app/billing.app.ts:190`           |
| secret | `internalSlackSignupsWebhook`       | ≈ `billingSecrets.internalSlackSignupsWebhook` | `src/app/billing.app.ts:191`           |
| config | `licensePaymentLinkId`              | `STRIPE_LICENSE_PAYMENT_LINK_ID`               | `../contract/src/billing.config.ts:12` |
| config | `licensePaymentUrl`                 | `STRIPE_LICENSE_PAYMENT_LINK_URL`              | `../contract/src/billing.config.ts:14` |
| config | `hubspotPortalId`                   | `HUBSPOT_PORTAL_ID`                            | `../contract/src/billing.config.ts:22` |
| config | `hubspotFormId`                     | `HUBSPOT_FORM_ID`                              | `../contract/src/billing.config.ts:23` |
| config | `hubspotReachedLimitFormId`         | `HUBSPOT_REACHED_LIMIT_FORM_ID`                | `../contract/src/billing.config.ts:24` |
| config | `bankDetails`                       | `LANGWATCH_BILLING_BANK_DETAILS`               | `../contract/src/billing.config.ts:25` |
| config | `isSaas`                            | `IS_SAAS`                                      | `../contract/src/billing.config.ts:27` |
| config | `publicBaseUrl`                     | `BASE_HOST`                                    | `../contract/src/billing.config.ts:29` |
| config | `nodeEnvironment`                   | `NODE_ENV`                                     | `../contract/src/billing.config.ts:31` |

<!-- readme:generated:end -->
