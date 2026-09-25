import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createPublicAppConfigMetaTag,
  defineBrowserConfig,
  injectPublicAppConfigIntoHtml,
  parsePublicAppConfigMetaContent,
  parsePublicConfigSlice,
  PUBLIC_APP_CONFIG_META_NAME,
  type PublicAppConfig,
} from "../public-app-config.ts";

const config: PublicAppConfig = {
  process: {
    appBaseUrl: "https://app.example.com",
    mode: "production",
    deployment: "self-hosted",
    nlp: false,
    browserTracing: false,
    sampleRatio: 1,
  },
  notification: { email: true },
};

const metaContent = (html: string) =>
  html.match(/<meta name="langwatch-public-config" content="([A-Za-z0-9_-]+)">/)?.[1] ?? "";

describe("public application config browser codec", () => {
  it("injects inert config into the shell and reads it back namespaced by owner", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<!doctype html><html><head></head><body></body></html>",
      config,
    });

    expect(html).not.toContain(`script data-${PUBLIC_APP_CONFIG_META_NAME}`);
    expect(parsePublicAppConfigMetaContent(metaContent(html))).toEqual(config);
  });

  it("uses an attribute-safe alphabet rather than embedding markup", () => {
    const html = injectPublicAppConfigIntoHtml({
      html: "<html><head></head><body></body></html>",
      config: { process: { appBaseUrl: 'https://example.com/"><script>bad</script>' } },
    });

    expect(html).not.toContain("<script>bad</script>");
    expect(metaContent(html)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses a value that is not an owner's slice before it reaches the HTML shell", () => {
    expect(() =>
      createPublicAppConfigMetaTag({ NEXTAUTH_SECRET: "must-not-cross-the-boundary" }),
    ).toThrow(/expected record/i);
  });
});

describe("a declared browser projection", () => {
  const declaration = defineBrowserConfig({
    schema: z.strictObject({ email: z.boolean() }),
    project: (owned: { provider?: string; apiKey?: string }) => ({
      email: Boolean(owned.provider),
      apiKey: owned.apiKey,
    }),
  });

  it("refuses a projection that answers a key its schema does not declare", () => {
    expect(() => declaration.project({ provider: "smtp", apiKey: "sk-private" })).toThrow(
      /unrecognized key/i,
    );
  });

  it("reads one owner's slice through that owner's schema, and names the owner it refuses", () => {
    const schema = z.strictObject({ email: z.boolean() });

    expect(parsePublicConfigSlice({ config, owner: "notification", schema })).toEqual({
      email: true,
    });
    expect(() => parsePublicConfigSlice({ config, owner: "auth", schema })).toThrow(/"auth"/);
  });
});
