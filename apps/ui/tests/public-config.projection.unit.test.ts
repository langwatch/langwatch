import { describe, expect, it } from "vitest";
import {
  resolveGatewayBaseUrl,
  resolvePublicAppConfig,
} from "../src/behavior/public-config.projection";

describe("public application configuration projection", () => {
  it("maps declared private deployment inputs and leaves credentials behind", () => {
    const config = resolvePublicAppConfig({
      BASE_HOST: "https://app.example.test",
      NODE_ENV: "production",
      IS_SAAS: "false",
      LW_GATEWAY_PUBLIC_URL: "https://gateway.example.test",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "secret-used-only-to-derive-email-capability",
      RUM_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
      NEXTAUTH_SECRET: "must-not-cross-the-browser-boundary",
    });

    expect(config).toMatchObject({
      appBaseUrl: "https://app.example.test",
      gatewayBaseUrl: "https://gateway.example.test",
      deployment: "self-hosted",
      telemetry: { browserTracing: true, sampleRatio: 1 },
      capabilities: { email: true },
    });
    expect(config).not.toHaveProperty("NEXTAUTH_SECRET");
    expect(config).not.toHaveProperty("RESEND_API_KEY");
  });

  it("retains the gateway public-url, legacy-url, and deployment-default precedence", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_PUBLIC_URL: "https://public.example.test",
        LW_GATEWAY_BASE_URL: "https://legacy.example.test",
        IS_SAAS: true,
      }),
    ).toBe("https://public.example.test");
  });
});
