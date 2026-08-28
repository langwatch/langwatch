import { describe, expect, it } from "vitest";
import { toPublicEnvironment } from "../src/behavior/public-environment";

describe("public environment compatibility projection", () => {
  it("preserves the legacy browser-hook field names without exposing new fields", () => {
    const environment = toPublicEnvironment({
      appBaseUrl: "https://app.example.test",
      gatewayBaseUrl: "https://gateway.example.test",
      deployment: "saas",
      demoProjectSlug: "demo",
      mode: "production",
      telemetry: {
        browserTracing: true,
        sampleRatio: 0.25,
        posthog: { key: "public-key", host: "https://posthog.example.test" },
      },
      capabilities: { email: true, nlp: true, langevals: false },
      licensePaymentUrl: "https://billing.example.test/license",
    });

    expect(environment).toEqual({
      BASE_HOST: "https://app.example.test",
      DEMO_PROJECT_SLUG: "demo",
      NODE_ENV: "production",
      HAS_EMAIL_PROVIDER_KEY: true,
      IS_SAAS: true,
      GATEWAY_BASE_URL: "https://gateway.example.test",
      POSTHOG_KEY: "public-key",
      POSTHOG_HOST: "https://posthog.example.test",
      RUM_ENABLED: true,
      RUM_SAMPLE_RATIO: 0.25,
      HAS_LANGWATCH_NLP_SERVICE: true,
      HAS_LANGEVALS_ENDPOINT: false,
      STRIPE_LICENSE_PAYMENT_LINK_URL: "https://billing.example.test/license",
    });
  });
});
