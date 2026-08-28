import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import Stripe from "stripe";

const stripeRuntimeConfigDefinition = RuntimeConfig.define({
  secretKey: Config.secret({ optional: true, env: "STRIPE_SECRET_KEY" }),
});

type StripePrivateConfig = ConfigValue<typeof stripeRuntimeConfigDefinition>;

/** Immutable Stripe SDK policy for one composed application process. */
export type StripeRuntimeConfig = Readonly<{
  secretKey: string | undefined;
  apiVersion: "2024-04-10";
  maxNetworkRetries: 1;
  telemetry: true;
}>;

/**
 * Parses the private Stripe setting and resolves the SDK policy once.
 * Stripe keeps its own default HTTP agent, so this runtime owns no additional
 * transport that must be closed during application shutdown.
 */
export function resolveStripeRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
): StripeRuntimeConfig {
  const configuration = RuntimeConfig.create({
    name: "application Stripe",
    definition: stripeRuntimeConfigDefinition,
    source,
  }).value;

  return toStripeRuntimeConfig(configuration);
}

function toStripeRuntimeConfig(configuration: StripePrivateConfig): StripeRuntimeConfig {
  return {
    secretKey: configuration.secretKey,
    apiVersion: "2024-04-10",
    maxNetworkRetries: 1,
    telemetry: true,
  };
}

/** One Stripe SDK client shared by every SaaS billing and webhook caller. */
export class AppStripeRuntime {
  static create(config: StripeRuntimeConfig): AppStripeRuntime {
    if (!config.secretKey) {
      throw new Error("A Stripe secret key is required for SaaS billing runtime");
    }

    return new AppStripeRuntime(
      new Stripe(config.secretKey, {
        apiVersion: config.apiVersion,
        maxNetworkRetries: config.maxNetworkRetries,
        telemetry: config.telemetry,
      }),
    );
  }

  private constructor(readonly client: Stripe) {}

  /** Stripe owns no closeable SDK handle when it uses the default HTTP agent. */
  async close(): Promise<void> {}
}
