/**
 * Compatibility view consumed by the legacy browser shell while its callers
 * migrate to the browser-safe `PublicAppConfig` model.
 */
export type PublicEnvironment = Readonly<{
  BASE_HOST: string;
  DEMO_PROJECT_SLUG: string | undefined;
  NODE_ENV: "development" | "test" | "production";
  IDENTITY_FRONT_DOOR: boolean;
  PASSKEYS_ENABLED: boolean;
  HAS_EMAIL_PROVIDER_KEY: boolean;
  IS_SAAS: boolean;
  GATEWAY_BASE_URL: string;
  POSTHOG_KEY: string | undefined;
  POSTHOG_HOST: string | undefined;
  RUM_ENABLED: boolean;
  RUM_SAMPLE_RATIO: number;
  HAS_LANGWATCH_NLP_SERVICE: boolean;
  HAS_LANGEVALS_ENDPOINT: boolean;
  STRIPE_LICENSE_PAYMENT_LINK_URL: string | undefined;
}>;
