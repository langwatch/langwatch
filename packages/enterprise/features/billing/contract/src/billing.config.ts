import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * What a deployment needs to charge through Stripe and to trust what Stripe
 * calls back with.
 *
 * The two credentials are required together and are the whole gate: without
 * the secret key nothing can be charged, and without the signing secret a
 * delivery cannot be told apart from an attacker's POST. Half a configuration
 * is the shape that boots and then refuses every delivery, which reads as an
 * outage rather than as the configuration mistake it is. Every leaf is
 * optional because a self-hosted install bills through nobody.
 */
export const billingServerConfigDefinition = RuntimeConfig.define({
  stripeSecretKey: Config.value(z.string().optional(), { env: "STRIPE_SECRET_KEY" }),
  /** Verified over the raw bytes per request, so a rotation needs no restart. */
  stripeWebhookSecret: Config.value(z.string().optional(), { env: "STRIPE_WEBHOOK_SECRET" }),
  licensePaymentLinkId: Config.value(z.string().optional(), {
    env: "STRIPE_LICENSE_PAYMENT_LINK_ID",
  }),
  /** Signs an issued licence key; absent means a licence checkout cannot be fulfilled. */
  licensePrivateKey: Config.value(z.string().optional(), {
    env: "LANGWATCH_LICENSE_PRIVATE_KEY",
  }),
  slackSubscriptionsChannel: Config.value(z.string().optional(), {
    env: "SLACK_CHANNEL_SUBSCRIPTIONS",
  }),
});

export type BillingServerConfig = ConfigValue<typeof billingServerConfigDefinition>;

export const billingServerConfigSchema = compileRuntimeConfig(billingServerConfigDefinition);

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
