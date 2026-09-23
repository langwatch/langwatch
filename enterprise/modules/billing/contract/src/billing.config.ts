import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * None is a credential: a payment-link id, a Slack channel address and the
 * bank details an invoice paid outside the payment provider prints. The
 * product-analytics target is ops' to declare; billing asks `OpsApi` for it.
 */
export const billingConfig = Config.define((c) => ({
  licensePaymentLinkId: c.env("STRIPE_LICENSE_PAYMENT_LINK_ID", z.string().optional()),
  slackSubscriptionsChannel: c.env("SLACK_CHANNEL_SUBSCRIPTIONS", z.string().optional()),
  slackSignupsChannel: c.env("SLACK_CHANNEL_SIGNUPS", z.string().optional()),
  slackSelfHostedChannel: c.env("SLACK_CHANNEL_SELF_HOSTED", z.string().optional()),
  bankDetails: c.env("LANGWATCH_BILLING_BANK_DETAILS", z.string().optional()),
}));

export type BillingServerConfig = ConfigOf<typeof billingConfig>;

/**
 * Both credentials required together; half a config looks like an outage.
 * The private key signs an issued licence key; absent means a licence
 * checkout cannot be fulfilled.
 */
export const billingSecrets = {
  stripeSecretKey: Secret.load("STRIPE_SECRET_KEY", { optional: true }),
  stripeWebhookSecret: Secret.load("STRIPE_WEBHOOK_SECRET", { optional: true }),
  licensePrivateKey: Secret.load("LANGWATCH_LICENSE_PRIVATE_KEY", { optional: true }),
} as const;

/** Refuses a payment provider that is half configured, at boot. */
export function assertBillingServerConfig(
  config: Readonly<{ stripeSecretKey?: string; stripeWebhookSecret?: string }>,
): void {
  const key = config.stripeSecretKey?.trim();
  const webhook = config.stripeWebhookSecret?.trim();
  if (Boolean(key) === Boolean(webhook)) return;

  throw new Error(
    "Billing needs both the payment provider's secret key and its webhook signing secret " +
      "(STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET). Set the missing one, or remove both to run " +
      "without billing.",
  );
}

/** All a browser learns: where a self-hosted licence is bought, if it is sold. */
export const billingWebConfigSchema = z.strictObject({
  licensePaymentUrl: z.string().min(1).optional(),
});

export type BillingWebConfig = z.infer<typeof billingWebConfigSchema>;
