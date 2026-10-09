// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { BillingAlertChannel } from "./billing-alert.channel.ts";
import type { BillingStripeChannels } from "./billing-stripe.channels.ts";
import type { ConnectedStatementMailChannel } from "./connected-statement-mail.channel.ts";
import type { HubspotFormChannel } from "./hubspot-form.channel.ts";
import type { LicenseEmailChannel } from "./license-email.channel.ts";
import type { UsageLimitEmailChannel } from "./usage-limit-email.channel.ts";

/** Every channel billing holds; Stripe is absent where the deployment holds no secret key. */
export interface BillingChannels {
  readonly stripe: BillingStripeChannels | undefined;
  readonly alerts: BillingAlertChannel;
  readonly hubspotForms: HubspotFormChannel;
  readonly licenseEmail: LicenseEmailChannel;
  readonly statementMail: ConnectedStatementMailChannel;
  readonly usageLimitEmail: UsageLimitEmailChannel;
}
