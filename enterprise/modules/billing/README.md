# billing

Billing: subscriptions, invoices and invoice billing for connected self-hosted customers. Its operations refuse off LangWatch Cloud and where no payment provider is configured.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                 |
| Subjects       | billing                                                                                               |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)           |
| Api token      | `BillingApi` = `moduleApi<BillingApi>()("billing")`, `contract/src/billing.api.ts:99` (12 operations) |
| Other token    | `BillingStripeWebhookApi`, `process/src/transport/billing-stripe-webhook.rest.ts:25`                  |
| Other token    | `BillingCurrencyApi`, `process/src/transport/currency.trpc.ts:21`                                     |
| Other token    | `BillingSubscriptionApi`, `process/src/transport/subscription.trpc.ts:69`                             |
| Installed by   | api, worker, tasks (process); ui (browser)                                                            |

## What billing owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                 | Declared at                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `BillingMeterCheckpoint`, `ConnectedBillingAccount`, `ConnectedCreditGrant`, `ConnectedInvoice`, `ConnectedSeatChange`, `ConnectedStatement`, `Organization`, `OrganizationUser`, `Project`, `Subscription`, `Team`, `User`                                                                                                                                                          | `process/src/repositories/prisma/prisma.billing-checkpoint.repository.ts:13` |
| Stores required                | prisma, redis, clickhouse                                                                                                                                                                                                                                                                                                                                                            | `process/src/repositories/live/live.billing.repositories.ts:15`              |
| Stores required                | prisma                                                                                                                                                                                                                                                                                                                                                                               | `process/src/repositories/prisma/prisma.billing.repositories.ts:23`          |
| Secrets                        | `stripeSecretKey` (STRIPE_SECRET_KEY), `stripeWebhookSecret` (STRIPE_WEBHOOK_SECRET), `internalSlackPlanLimitWebhook` (SLACK_PLAN_LIMIT_CHANNEL), `internalSlackSubscriptionsWebhook` (SLACK_CHANNEL_SUBSCRIPTIONS), `internalSlackSelfHostedWebhook` (SLACK_CHANNEL_SELF_HOSTED), `internalSlackSignupsWebhook` (≈ `billingSecrets.internalSlackSignupsWebhook`)                    | `process/src/app/billing.app.ts:183`                                         |
| Config                         | `licensePaymentLinkId` (STRIPE_LICENSE_PAYMENT_LINK_ID), `licensePaymentUrl` (STRIPE_LICENSE_PAYMENT_LINK_URL), `hubspotPortalId` (HUBSPOT_PORTAL_ID), `hubspotFormId` (HUBSPOT_FORM_ID), `hubspotReachedLimitFormId` (HUBSPOT_REACHED_LIMIT_FORM_ID), `bankDetails` (LANGWATCH_BILLING_BANK_DETAILS), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST), `nodeEnvironment` (NODE_ENV) | `contract/src/billing.config.ts:12`                                          |

Anything else billing needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                  |
| --------------- | ----------------- | ------------------------------------------------------- |
| `authorization` | `AuthzApi`        | [authz](../../../modules/authz/README.md)               |
| `licensing`     | `LicensingApi`    | [licensing](../licensing/README.md)                     |
| `notifications` | `NotificationApi` | [notification](../../../modules/notification/README.md) |

## Who depends on billing

[entitlement](../../../modules/entitlement/README.md), [organization](../../../modules/organization/README.md) (as a peer).

<!-- readme:generated:end -->
