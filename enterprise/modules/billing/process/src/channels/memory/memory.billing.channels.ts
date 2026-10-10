// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { billingSecrets } from "@langwatch/enterprise-billing-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { ConnectedStatement } from "../../features/connected-billing/services/connected-monthly-statement.service.ts";
import type { LicenseEmailDelivery } from "../../features/license-purchase/services/license-purchase.service.ts";
import { BillingAlertChannel, type BillingAlertMessage } from "../billing-alert.channel.ts";
import type { BillingChannels } from "../billing.channels.ts";
import { ConnectedStatementMailChannel } from "../connected-statement-mail.channel.ts";
import { HubspotFormChannel, type HubspotFormReceipt } from "../hubspot-form.channel.ts";
import { LicenseEmailChannel } from "../license-email.channel.ts";
import { UsageLimitEmailChannel } from "../usage-limit-email.channel.ts";
import { MemoryConnectedInvoicingChannel } from "./memory.connected-invoicing.channel.ts";
import { MemoryStripeCustomersChannel } from "./memory.stripe-customers.channel.ts";
import { MemoryStripeInvoicesChannel } from "./memory.stripe-invoices.channel.ts";
import { MemoryStripeMetersChannel } from "./memory.stripe-meters.channel.ts";
import { MemoryStripePricesChannel } from "./memory.stripe-prices.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "./memory.stripe-subscriptions.channel.ts";
import { MemoryStripeWebhooksChannel } from "./memory.stripe-webhooks.channel.ts";

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

/** Records what billing would have posted to Slack, without a network call. */
class MemoryBillingAlertChannel extends BillingAlertChannel {
  readonly sent: { webhookUrl: string; message: BillingAlertMessage }[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryBillingAlertChannel {
    return new MemoryBillingAlertChannel();
  }

  async send(input: { webhookUrl: string; message: BillingAlertMessage }): Promise<void> {
    this.sent.push(input);
  }
}

/** Keeps every statement handed over and sends nothing, where no mailer is composed. */
export class MemoryConnectedStatementMailChannel extends ConnectedStatementMailChannel {
  readonly sent: ConnectedStatement[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryConnectedStatementMailChannel {
    return new MemoryConnectedStatementMailChannel();
  }

  async send(statement: ConnectedStatement): Promise<void> {
    this.sent.push(statement);
  }
}

/** Records what billing would have submitted to HubSpot, without a network call. */
class MemoryHubspotFormChannel extends HubspotFormChannel {
  readonly submitted: { url: string; body: object }[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryHubspotFormChannel {
    return new MemoryHubspotFormChannel();
  }

  async submit(input: { url: string; body: object }): Promise<HubspotFormReceipt> {
    this.submitted.push(input);
    return { ok: true, status: 200 };
  }
}

/** Records the licences it would have mailed, for suites and mail-less deployments. */
export class MemoryLicenseEmailChannel extends LicenseEmailChannel {
  readonly sent: LicenseEmailDelivery[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryLicenseEmailChannel {
    return new MemoryLicenseEmailChannel();
  }

  async send(input: LicenseEmailDelivery): Promise<void> {
    this.sent.push(input);
  }
}

/** Accepts the approaching-limit mail and sends nothing, where no mailer is composed. */
export class MemoryUsageLimitEmailChannel extends UsageLimitEmailChannel {
  private constructor() {
    super();
  }

  static create(): MemoryUsageLimitEmailChannel {
    return new MemoryUsageLimitEmailChannel();
  }

  async send(): Promise<void> {}
}
