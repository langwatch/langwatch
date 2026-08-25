import { describe, expect, it } from "vitest";
import {
  injectPublicAppConfigIntoHtml,
  PUBLIC_APP_CONFIG_META_NAME,
  readPublicAppConfig,
  type PublicAppConfig,
} from "../public-config";
import { PublicAppConfigService } from "../public-config.server";

const config: PublicAppConfig = {
  appBaseUrl: "https://app.example.com",
  gatewayBaseUrl: "https://gateway.example.com",
  deployment: "self-hosted",
  mode: "production",
  telemetry: { browserTracing: false, sampleRatio: 1 },
  capabilities: { email: true, nlp: false, langevals: false },
};

describe("public application config", () => {
  it("injects inert config into the shell and reads it through the schema", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<!doctype html><html><head></head><body></body></html>",
      config,
    });
    const content = html.match(
      /<meta name="langwatch-public-config" content="([A-Za-z0-9_-]+)">/,
    )?.[1];

    expect(html).not.toContain(`script data-${PUBLIC_APP_CONFIG_META_NAME}`);
    expect(
      readPublicAppConfig({
        querySelector: () =>
          content ? ({ getAttribute: () => content } as unknown as Element) : null,
      }),
    ).toEqual(config);
  });

  it("uses an attribute-safe alphabet rather than embedding markup", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<html><head></head><body></body></html>",
      config: {
        ...config,
        appBaseUrl: 'https://example.com/\"><script>bad</script>',
      },
    });

    expect(html).not.toContain("<script>bad</script>");
    const payload = html.match(/content="([A-Za-z0-9_-]+)"/)?.[1];
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("maps only the allow-listed semantic values", () => {
    const resolved = new PublicAppConfigService().resolve({
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
    } as Parameters<PublicAppConfigService["resolve"]>[0]);

    expect(resolved.capabilities.email).toBe(true);
    expect(resolved.telemetry).toMatchObject({
      browserTracing: true,
      sampleRatio: 0.25,
    });
    expect(resolved).not.toHaveProperty("NEXTAUTH_SECRET");
  });
});
