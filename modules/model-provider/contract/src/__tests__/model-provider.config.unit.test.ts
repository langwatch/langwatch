import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { modelProviderConfig } from "../model-provider.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "model-provider", config: modelProviderConfig }],
    environment,
  })["model-provider"];

describe("model provider server configuration", () => {
  describe("given install-wide provider settings", () => {
    /** @scenario "A provider row falls back to the install-wide provider settings" */
    it("reads each by its provider field name, and a blank one as unset", () => {
      const fallbacks = read({
        OPENAI_BASE_URL: "https://proxy.example.com/v1",
        VERTEXAI_PROJECT: "acme-project",
        AWS_REGION_NAME: " ",
      }).providerFallbacks;
      expect(fallbacks).toMatchObject({
        OPENAI_BASE_URL: "https://proxy.example.com/v1",
        VERTEXAI_PROJECT: "acme-project",
      });
      expect(fallbacks.AWS_REGION_NAME).toBeUndefined();
    });

    /** @scenario "A provider row falls back to the install-wide provider settings" */
    it("never reads a key or secret from the environment", () => {
      const fallbacks = read({
        OPENAI_API_KEY: "sk-env",
        AWS_SECRET_ACCESS_KEY: "env-secret",
      }).providerFallbacks;
      expect(Object.keys(fallbacks).filter((name) => /KEY|SECRET/.test(name))).toEqual([]);
    });
  });

  describe("given the deployment sets no allowlist", () => {
    /** @scenario "An absent allowlist resolves to an empty one, never a wildcard" */
    it("resolves an empty allowlist rather than a wildcard", () => {
      expect(read({}).allowedProxyHosts).toEqual([]);
    });
  });

  describe("given the allowlist carries blanks and spacing", () => {
    /** @scenario "An absent allowlist resolves to an empty one, never a wildcard" */
    it("drops the blanks so no empty host sits in the list", () => {
      expect(read({ ALLOWED_PROXY_HOSTS: " a.test , ,b.test " }).allowedProxyHosts).toEqual([
        "a.test",
        "b.test",
      ]);
    });
  });

  describe("given the local-address fence carries the deployment's spelling", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads 1 and true as on and everything else as off", () => {
      expect(read({ BLOCK_LOCAL_HTTP_CALLS: "true" }).blockLocalHttpCalls).toBe(true);
      expect(read({ BLOCK_LOCAL_HTTP_CALLS: "yes" }).blockLocalHttpCalls).toBe(false);
    });
  });

  describe("given a blank default model", () => {
    /** @scenario "A blank identifier resolves to absent rather than to an empty filter" */
    it("resolves it to absent so nothing composes an empty model id", () => {
      expect(read({ LANGWATCH_DEFAULT_MODEL: "" }).defaultModel).toBeUndefined();
    });
  });

  describe("given the Codex issuer base", () => {
    /** @scenario "A Codex base that is unset or blank reaches OpenAI" */
    it("reads as unset when it is not exported or exported blank", () => {
      expect(read({}).codexOAuthIssuer).toBeUndefined();
      expect(read({ CODEX_OAUTH_ISSUER: "  " }).codexOAuthIssuer).toBeUndefined();
    });

    /** @scenario "Codex is reached at the bases the deployment configures" */
    it("carries the configured URL and refuses a value that is not one", () => {
      expect(read({ CODEX_OAUTH_ISSUER: "http://127.0.0.1:6970/codex" }).codexOAuthIssuer).toBe(
        "http://127.0.0.1:6970/codex",
      );
      expect(() => read({ CODEX_OAUTH_ISSUER: "not a url" })).toThrow(/CODEX_OAUTH_ISSUER/);
    });
  });
});
