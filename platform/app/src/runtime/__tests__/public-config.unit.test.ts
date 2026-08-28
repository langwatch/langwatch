import { describe, expect, it } from "vitest";
import {
  LOCAL_GATEWAY_URL,
  PublicAppConfigService,
  type PublicAppConfigSource,
  resolveGatewayBaseUrl,
  SAAS_GATEWAY_URL,
} from "../public-config.server";

describe("public application config source projection", () => {
  it("maps only the allow-listed semantic values", () => {
    const source: PublicAppConfigSource & { NEXTAUTH_SECRET: string } = {
      BASE_HOST: "https://app.example.com",
      NODE_ENV: "production",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "secret",
      IS_SAAS: false,
      LW_GATEWAY_PUBLIC_URL: "https://gateway.example.com",
      RUM_ENABLED: true,
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
      RUM_SAMPLE_RATIO: 0.25,
      NEXTAUTH_SECRET: "must not be visible",
    };
    const resolved = new PublicAppConfigService().resolve(source);

    expect(resolved.capabilities.email).toBe(true);
    expect(resolved.telemetry).toMatchObject({
      browserTracing: true,
      sampleRatio: 0.25,
    });
    expect(resolved).not.toHaveProperty("NEXTAUTH_SECRET");
  });
});

describe("resolveGatewayBaseUrl", () => {
  it("resolves the canonical .ai gateway host for SaaS", () => {
    const resolved = resolveGatewayBaseUrl({ IS_SAAS: true });

    expect(resolved).toBe("https://gateway.langwatch.ai");
    expect(resolved).not.toContain(".com");
    expect(SAAS_GATEWAY_URL).toBe("https://gateway.langwatch.ai");
  });

  it("resolves the local Go gateway port for self-hosted deployments", () => {
    expect(resolveGatewayBaseUrl({ IS_SAAS: false })).toBe(LOCAL_GATEWAY_URL);
  });

  it("prefers the public gateway URL over the legacy URL and default", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_PUBLIC_URL: "https://gw.acme.example",
        LW_GATEWAY_BASE_URL: "https://legacy.acme.example",
        IS_SAAS: true,
      }),
    ).toBe("https://gw.acme.example");
  });

  it("uses the legacy gateway URL when no public URL is configured", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_BASE_URL: "https://legacy.acme.example",
        IS_SAAS: true,
      }),
    ).toBe("https://legacy.acme.example");
  });
});
