import { Config, isSaas, publicBaseUrl, type ConfigOf } from "@langwatch/config";
import { defineBrowserConfig } from "@langwatch/config/public-app-config";
import { Secret } from "@langwatch/secrets/secret";
import { internalSlackSignupsWebhook } from "@langwatch/secrets/shared-secrets";
import { z } from "zod";

/**
 * None is a credential: a payment-link id and the bank details an invoice paid
 * outside the payment provider prints.
 */
export const billingConfig = Config.define((c) => ({
  licensePaymentLinkId: c.env("STRIPE_LICENSE_PAYMENT_LINK_ID", z.string().optional()),
  /** Where a self-hosted operator buys a licence; blank means none. */
  licensePaymentUrl: c.env(
    "STRIPE_LICENSE_PAYMENT_LINK_URL",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
  /** The HubSpot portal and forms a signup and a reached plan limit are submitted to. */
  hubspotPortalId: c.env("HUBSPOT_PORTAL_ID", z.string().optional()),
  hubspotFormId: c.env("HUBSPOT_FORM_ID", z.string().optional()),
  hubspotReachedLimitFormId: c.env("HUBSPOT_REACHED_LIMIT_FORM_ID", z.string().optional()),
  bankDetails: c.env("LANGWATCH_BILLING_BANK_DETAILS", z.string().optional()),
  /** The shared leaf: Cloud bills subscriptions and reports usage; an install runs neither. */
  isSaas,
  /** The shared leaf: the origin the usage links and notices point back at. */
  publicBaseUrl,
}));

export type BillingServerConfig = ConfigOf<typeof billingConfig>;

/**
 * Both credentials required together; half a config looks like an outage.
 * The licence signing key is licensing's own (`licensingSecrets`).
 */
export const billingSecrets = {
  stripeSecretKey: Secret.load("STRIPE_SECRET_KEY", { optional: true }),
  stripeWebhookSecret: Secret.load("STRIPE_WEBHOOK_SECRET", { optional: true }),
  /** Slack incoming webhooks are credentials (ADR-132); the sign-ups one is a shared handle. */
  internalSlackPlanLimitWebhook: Secret.load("SLACK_PLAN_LIMIT_CHANNEL", { optional: true }),
  internalSlackSubscriptionsWebhook: Secret.load("SLACK_CHANNEL_SUBSCRIPTIONS", { optional: true }),
  internalSlackSelfHostedWebhook: Secret.load("SLACK_CHANNEL_SELF_HOSTED", { optional: true }),
  internalSlackSignupsWebhook,
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

export const billingBrowserConfig = defineBrowserConfig({
  schema: billingWebConfigSchema,
  project: (config: BillingServerConfig) =>
    config.licensePaymentUrl ? { licensePaymentUrl: config.licensePaymentUrl } : {},
});
