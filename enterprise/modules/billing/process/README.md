# @langwatch/enterprise-billing-process

The server half of [billing](../README.md). Billing: subscriptions, invoices and invoice billing for connected self-hosted customers.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("billing").withRepositories(billingRepositories).withApi(BillingModule).withTransports(connectedBillingTrpcTransport, billingStripeWebhookRest, currencyTrpcTransport, subscriptionTrpcTransport).withEventing(connectedBillingEventing).withEventing(billingReportingEventing).withEventing(billingLifecycleEventing).withTasks(…)`, `src/billing.module.ts:37`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`BillingApi`)

What the billing module answers other modules: invoice billing for a connected self-hosted customer (ADR-156 section 7). Every operation refuses off LangWatch Cloud, and where no payment provider is configured. The backoffice operations answer anyone without the platform-operator grant not found.

Peers call these through the token, declared at `../contract/src/billing.api.ts:36`; nothing else in this package is public.

#### `getConnectedBillingOverview`

The commercial state of one connected customer.

```typescript
getConnectedBillingOverview(input: { organizationId: string }, by: BillingStaff | null): Promise<ConnectedBillingOverview>;
```

#### `onboardConnectedCustomer`

Onboards a customer, or completes an onboarding that stopped halfway.

```typescript
onboardConnectedCustomer(input: ConnectedOnboardRequest, by: BillingStaff | null): Promise<ConnectedBillingAccountView>;
```

#### `addConnectedCommit`

Raises the commit mid-term: a second paid credit, and the budget with it.

```typescript
addConnectedCommit(input: ConnectedAddCommitRequest, by: BillingStaff | null): Promise<ConnectedCreditGrantView>;
```

#### `renewConnectedTerm`

```typescript
renewConnectedTerm(input: ConnectedRenewRequest, by: BillingStaff | null): Promise<ConnectedBillingAccountView>;
```

#### `completeConnectedRenewalIfDue`

```typescript
completeConnectedRenewalIfDue(input: { organizationId: string }, by: BillingStaff | null): Promise<RenewalCompletion>;
```

#### `markConnectedInvoicePaidOutOfBand`

Finance received the money outside the payment provider.

```typescript
markConnectedInvoicePaidOutOfBand(input: { stripeInvoiceId: string }, by: BillingStaff | null): Promise<void>;
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

#### `countBillableEventsByProjects`

This UTC billing month's approximate billable events per named project, 0 where a project has none; unknown when no analytics store is composed. Main's `EventUsageService`.

```typescript
countBillableEventsByProjects(input: { organizationId: string; projectIds: string[]; }): Promise<{ projectId: string; count: number }[] | typeof USAGE_UNKNOWN>;
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
type Headers = z.infer<typeof billingStripeWebhookHeadersSchema>; // ../contract/src/billing-types.ts:226
type Response = z.infer<typeof billingStripeWebhookReceiptSchema>; // ../contract/src/billing-types.ts:224
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

Contract `../contract/src/subscription.trpc.ts:41`, router `src/transport/subscription.trpc.ts:94`.

| Procedure                            | Kind     | Gate                             | Input                     | Output                           |
| ------------------------------------ | -------- | -------------------------------- | ------------------------- | -------------------------------- |
| `subscription.addTeamMemberOrEvents` | mutation | Permission `organization:manage` | inline                    | `subscriptionItemsUpdatedSchema` |
| `subscription.create`                | mutation | Permission `organization:manage` | inline                    | `billingRedirectSchema`          |
| `subscription.manage`                | mutation | Permission `organization:manage` | inline                    | `billingPortalSessionSchema`     |
| `subscription.previewProration`      | query    | Permission `organization:manage` | inline                    | `providerOwnedSchema`            |
| `subscription.getLastSubscription`   | query    | Permission `organization:view`   | `organizationScopeSchema` | `providerOwnedSchema`            |
| `subscription.upgradeWithInvites`    | mutation | Permission `organization:manage` | inline                    | `billingRedirectSchema`          |
| `subscription.prospective`           | mutation | Permission `organization:manage` | inline                    | `providerOwnedSchema`            |
| `subscription.listInvoices`          | query    | Permission `organization:view`   | `organizationScopeSchema` | inline                           |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `billing_lifecycle` (aggregate `billing_lifecycle`)

Declared at `src/eventing/billing-lifecycle.pipeline.ts:57`. Events: `subscriptionChangedEventSchema`, `subscriptionStartedEventSchema`, `checkoutCompletedEventSchema`.

| Kind            | Name                           | Handles               | Declared at                                     |
| --------------- | ------------------------------ | --------------------- | ----------------------------------------------- |
| command         | `recordSubscriptionChanged`    | –                     | `src/eventing/billing-lifecycle.pipeline.ts:66` |
| command         | `recordSubscriptionStarted`    | –                     | `src/eventing/billing-lifecycle.pipeline.ts:67` |
| command         | `recordCheckoutCompleted`      | –                     | `src/eventing/billing-lifecycle.pipeline.ts:68` |
| peer subscriber | `organizationSeatLimitReached` | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:69` |
| peer subscriber | `usageLimitReached`            | ≈ event type not read | `src/eventing/billing-lifecycle.pipeline.ts:73` |

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

| Task                 | Class                  | Declared at                                |
| -------------------- | ---------------------- | ------------------------------------------ |
| `stripe-prices-sync` | `StripePricesSyncTask` | `src/tasks/stripe-prices-sync.task.ts:482` |

## Configuration

| Kind   | Leaf                                | Environment variable                           | Declared at                            |
| ------ | ----------------------------------- | ---------------------------------------------- | -------------------------------------- |
| secret | `stripeSecretKey`                   | `STRIPE_SECRET_KEY`                            | `src/app/billing.app.ts:214`           |
| secret | `stripeWebhookSecret`               | `STRIPE_WEBHOOK_SECRET`                        | `src/app/billing.app.ts:215`           |
| secret | `internalSlackPlanLimitWebhook`     | `SLACK_PLAN_LIMIT_CHANNEL`                     | `src/app/billing.app.ts:216`           |
| secret | `internalSlackSubscriptionsWebhook` | `SLACK_CHANNEL_SUBSCRIPTIONS`                  | `src/app/billing.app.ts:217`           |
| secret | `internalSlackSelfHostedWebhook`    | `SLACK_CHANNEL_SELF_HOSTED`                    | `src/app/billing.app.ts:218`           |
| secret | `internalSlackSignupsWebhook`       | ≈ `billingSecrets.internalSlackSignupsWebhook` | `src/app/billing.app.ts:219`           |
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
