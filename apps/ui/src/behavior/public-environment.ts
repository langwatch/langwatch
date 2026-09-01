import type { PublicAppConfig } from "../model/public-config";
import type { PublicEnvironment } from "../model/public-environment";

/** Projects the browser bootstrap contract into the temporary legacy hook shape. */
export function toPublicEnvironment(config: PublicAppConfig): PublicEnvironment {
  return {
    BASE_HOST: config.appBaseUrl,
    DEMO_PROJECT_SLUG: config.demoProjectSlug,
    NODE_ENV: config.mode,
    IDENTITY_FRONT_DOOR: config.identityFrontDoor,
    PASSKEYS_ENABLED: config.passkeys,
    HAS_EMAIL_PROVIDER_KEY: config.capabilities.email,
    IS_SAAS: config.deployment === "saas",
    GATEWAY_BASE_URL: config.gatewayBaseUrl,
    POSTHOG_KEY: config.telemetry.posthog?.key,
    POSTHOG_HOST: config.telemetry.posthog?.host,
    RUM_ENABLED: config.telemetry.browserTracing,
    RUM_SAMPLE_RATIO: config.telemetry.sampleRatio,
    HAS_LANGWATCH_NLP_SERVICE: config.capabilities.nlp,
    HAS_LANGEVALS_ENDPOINT: config.capabilities.langevals,
    STRIPE_LICENSE_PAYMENT_LINK_URL: config.licensePaymentUrl,
  };
}
