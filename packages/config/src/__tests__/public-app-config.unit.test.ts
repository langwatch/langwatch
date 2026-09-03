import { describe, expect, it } from "vitest";
import {
  createPublicAppConfigMetaTag,
  injectPublicAppConfigIntoHtml,
  parsePublicAppConfigMetaContent,
  PUBLIC_APP_CONFIG_META_NAME,
  type PublicAppConfig,
} from "../public-app-config";

const config: PublicAppConfig = {
  appBaseUrl: "https://app.example.com",
  gatewayBaseUrl: "https://gateway.example.com",
  deployment: "self-hosted",
  mode: "production",
  telemetry: { browserTracing: false, sampleRatio: 1 },
  capabilities: { email: true, nlp: false, langevals: false },
  passkeys: false,
  identityFrontDoor: false,
};

describe("public application config browser codec", () => {
  it("injects inert config into the shell and reads it through the schema", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<!doctype html><html><head></head><body></body></html>",
      config,
    });
    const content = html.match(
      /<meta name="langwatch-public-config" content="([A-Za-z0-9_-]+)">/,
    )?.[1];

    expect(html).not.toContain(`script data-${PUBLIC_APP_CONFIG_META_NAME}`);
    expect(parsePublicAppConfigMetaContent(content ?? "")).toEqual(config);
  });

  it("uses an attribute-safe alphabet rather than embedding markup", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<html><head></head><body></body></html>",
      config: {
        ...config,
        appBaseUrl: 'https://example.com/"><script>bad</script>',
      },
    });

    expect(html).not.toContain("<script>bad</script>");
    expect(html.match(/content="([A-Za-z0-9_-]+)"/)?.[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects secret-shaped root fields before they reach the HTML shell", () => {
    const configWithSecret = { ...config, NEXTAUTH_SECRET: "must-not-cross-the-boundary" };

    expect(() => createPublicAppConfigMetaTag(configWithSecret)).toThrow(/unrecognized key/i);
  });

  it("rejects unknown nested fields before they reach the HTML shell", () => {
    const configWithUnknownTelemetry = {
      ...config,
      telemetry: { ...config.telemetry, collectorHeaders: "secret" },
    };

    expect(() => createPublicAppConfigMetaTag(configWithUnknownTelemetry)).toThrow(
      /unrecognized key/i,
    );
  });
});
