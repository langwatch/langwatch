// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { billingSecrets, type BillingServerConfig } from "@langwatch/enterprise-billing-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";
import type { ScopedSecrets } from "@langwatch/secrets";

import type { BillingChannels } from "../billing.channels.ts";
import { SesConnectedStatementMailChannel } from "../ses/ses.connected-statement-mail.channel.ts";
import { SesLicenseEmailChannel } from "../ses/ses.license-email.channel.ts";
import { SesUsageLimitEmailChannel } from "../ses/ses.usage-limit-email.channel.ts";
import { SlackBillingAlertChannel } from "../slack/slack.billing-alert.channel.ts";
import { composeHttpBillingStripe } from "./http.billing-stripe.channels.ts";
import { HttpHubspotFormChannel } from "./http.hubspot-form.channel.ts";
import { HttpStripeWebhooksChannel } from "./http.stripe-webhooks.channel.ts";

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
