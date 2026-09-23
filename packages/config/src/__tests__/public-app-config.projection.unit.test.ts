import { describe, expect, it } from "vitest";

import {
  LOCAL_GATEWAY_URL,
  resolveGatewayBaseUrl,
  resolvePublicAppConfig,
  SAAS_GATEWAY_URL,
} from "../public-app-config.projection.ts";

describe("public application configuration projection", () => {
  it("maps declared private deployment inputs and leaves credentials behind", () => {
    // The credential is a handle its owner resolves; the projection is handed
    // presence, so no secret value is in scope here to leave behind.
    const config = resolvePublicAppConfig(
      {
        BASE_HOST: "https://app.example.test",
        NODE_ENV: "production",
        IS_SAAS: "false",
        LW_GATEWAY_PUBLIC_URL: "https://gateway.example.test",
        EMAIL_PROVIDER: "resend",
        RUM_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
        NEXTAUTH_SECRET: "must-not-cross-the-browser-boundary",
      },
      { resend: true },
    );

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

  it("hands the browser HIDE_DEV_INDICATOR only when it is switched on", () => {
    const base = { BASE_HOST: "https://app.example.test", NODE_ENV: "development" };

    expect(resolvePublicAppConfig({ ...base, HIDE_DEV_INDICATOR: "1" })).toMatchObject({
      hideDevIndicator: true,
    });
    expect(resolvePublicAppConfig({ ...base, HIDE_DEV_INDICATOR: "true" })).toMatchObject({
      hideDevIndicator: true,
    });
    expect(resolvePublicAppConfig({ ...base, HIDE_DEV_INDICATOR: "false" })).not.toHaveProperty(
      "hideDevIndicator",
    );
    expect(resolvePublicAppConfig(base)).not.toHaveProperty("hideDevIndicator");
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

  it("falls back to the legacy gateway url when no public url is configured", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_BASE_URL: "https://legacy.example.test",
        IS_SAAS: true,
      }),
    ).toBe("https://legacy.example.test");
  });

  it("resolves the canonical .ai gateway host for SaaS", () => {
    const resolved = resolveGatewayBaseUrl({ IS_SAAS: true });

    expect(resolved).toBe("https://gateway.langwatch.ai");
    // The SaaS gateway is a .ai host. A .com here is a real outage, not a typo.
    expect(resolved).not.toContain(".com");
    expect(SAAS_GATEWAY_URL).toBe("https://gateway.langwatch.ai");
  });

  it("resolves the local Go gateway port for self-hosted deployments", () => {
    expect(resolveGatewayBaseUrl({ IS_SAAS: false })).toBe(LOCAL_GATEWAY_URL);
  });
});
