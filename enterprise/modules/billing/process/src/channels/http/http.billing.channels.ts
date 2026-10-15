// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { billingSecrets, type BillingServerConfig } from "@langwatch/enterprise-billing-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";
import type { ScopedSecrets } from "@langwatch/secrets";
import Stripe from "stripe";

import type { BillingChannels } from "../billing.channels.ts";
import { HubspotFormChannel, type HubspotFormReceipt } from "../hubspot-form.channel.ts";
import { SesConnectedStatementMailChannel } from "../ses/ses.connected-statement-mail.channel.ts";
import { SesLicenseEmailChannel } from "../ses/ses.license-email.channel.ts";
import { SesUsageLimitEmailChannel } from "../ses/ses.usage-limit-email.channel.ts";
import { SlackBillingAlertChannel } from "../slack/slack.billing-alert.channel.ts";
import { StripeWebhooksChannel } from "../stripe-webhooks.channel.ts";
import { composeHttpBillingStripe } from "./http.billing-stripe.channels.ts";

/** Stripe over its secret key, Slack and HubSpot over HTTP, mail through notification (§5 binding). */
export class HttpBillingChannels {
  static readonly requires = [] as const;
  static readonly binds = { notifications: NotificationApi } as const;

  static async create({
    config,
    secrets,
    bound,
  }: {
    config: BillingServerConfig;
    secrets: ScopedSecrets;
    bound: BoundApis<typeof HttpBillingChannels.binds>;
  }): Promise<BillingChannels> {
    const mailer: MailSender = { send: (content) => bound.notifications.sendEmail(content) };
    const webhooks = await secrets.into(billingSecrets.stripeWebhookSecret, (signingSecret) =>
      HttpStripeWebhooksChannel.create({ signingSecret }),
    );
    const { nodeEnvironment, stripeApiBase: apiBase } = config;
    const stripe = await secrets.into(billingSecrets.stripeSecretKey, (secretKey) =>
      secretKey
        ? { webhooks, ...composeHttpBillingStripe({ secretKey, nodeEnvironment, apiBase }) }
        : void 0,
    );
    return {
      stripe,
      alerts: SlackBillingAlertChannel.create(),
      hubspotForms: HttpHubspotFormChannel.create(),
      licenseEmail: SesLicenseEmailChannel.create(mailer),
      statementMail: SesConnectedStatementMailChannel.create(mailer),
      usageLimitEmail: SesUsageLimitEmailChannel.create(mailer),
    };
  }
}

const HUBSPOT_TIMEOUT_MS = 10_000;

/** Posts a form to HubSpot over HTTP, bounded by a timeout. */
export class HttpHubspotFormChannel extends HubspotFormChannel {
  private constructor(private readonly fetchFn: typeof fetch) {
    super();
  }

  static create(options: { fetchFn?: typeof fetch } = {}): HttpHubspotFormChannel {
    return new HttpHubspotFormChannel(options.fetchFn ?? fetch);
  }

  async submit({ url, body }: { url: string; body: object }): Promise<HubspotFormReceipt> {
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HUBSPOT_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  }
}

/** Verifies a delivery as Stripe signs it; needs no API client, only the signing secret. */
export class HttpStripeWebhooksChannel extends StripeWebhooksChannel {
  private constructor(private readonly secret: string | undefined) {
    super();
  }

  static create(input: { signingSecret: string | undefined }): HttpStripeWebhooksChannel {
    return new HttpStripeWebhooksChannel(input.signingSecret?.trim() || void 0);
  }

  isConfigured(): boolean {
    return this.secret !== void 0;
  }

  constructEvent({ rawBody, signature }: { rawBody: Uint8Array; signature: string }): Stripe.Event {
    if (!this.secret) throw new Error("No Stripe webhook signing secret is configured");
    return Stripe.webhooks.constructEvent(Buffer.from(rawBody), signature, this.secret);
  }
}
