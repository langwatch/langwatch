// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { billingSecrets } from "@langwatch/enterprise-billing-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { BillingChannels } from "../billing.channels.ts";
import { MemoryBillingAlertChannel } from "./memory.billing-alert.channel.ts";
import { MemoryConnectedInvoicingChannel } from "./memory.connected-invoicing.channel.ts";
import { MemoryConnectedStatementMailChannel } from "./memory.connected-statement-mail.channel.ts";
import { MemoryHubspotFormChannel } from "./memory.hubspot-form.channel.ts";
import { MemoryLicenseEmailChannel } from "./memory.license-email.channel.ts";
import { MemoryStripeCustomersChannel } from "./memory.stripe-customers.channel.ts";
import { MemoryStripeInvoicesChannel } from "./memory.stripe-invoices.channel.ts";
import { MemoryStripeMetersChannel } from "./memory.stripe-meters.channel.ts";
import { MemoryStripePricesChannel } from "./memory.stripe-prices.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "./memory.stripe-subscriptions.channel.ts";
import { MemoryStripeWebhooksChannel } from "./memory.stripe-webhooks.channel.ts";
import { MemoryUsageLimitEmailChannel } from "./memory.usage-limit-email.channel.ts";

/** Every billing message recorded in-process; Stripe's twins stand in only where a key is set. */
export class MemoryBillingChannels {
  static readonly requires = [] as const;

  static async create({ secrets }: { secrets: ScopedSecrets }): Promise<BillingChannels> {
    const webhooks = await secrets.into(billingSecrets.stripeWebhookSecret, (signingSecret) =>
      MemoryStripeWebhooksChannel.create({ signingSecret }),
    );
    const stripe = await secrets.into(billingSecrets.stripeSecretKey, (secretKey) =>
      secretKey
        ? {
            webhooks,
            customers: MemoryStripeCustomersChannel.create(),
            subscriptions: MemoryStripeSubscriptionsChannel.create(),
            invoices: MemoryStripeInvoicesChannel.create(),
            prices: MemoryStripePricesChannel.create(),
            meters: MemoryStripeMetersChannel.create(),
            connectedInvoicing: MemoryConnectedInvoicingChannel.create(),
          }
        : void 0,
    );
    return {
      stripe,
      alerts: MemoryBillingAlertChannel.create(),
      hubspotForms: MemoryHubspotFormChannel.create(),
      licenseEmail: MemoryLicenseEmailChannel.create(),
      statementMail: MemoryConnectedStatementMailChannel.create(),
      usageLimitEmail: MemoryUsageLimitEmailChannel.create(),
    };
  }
}
