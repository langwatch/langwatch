import { redactSecretsInText } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";

import { API_KEY_PREFIX, INGEST_KEY_PREFIX, LEGACY_PAT_PREFIX } from "../api-key.tokens.ts";

// Redaction package duplicates key prefixes (can't import SDK). This test keeps them in sync.
// Renaming a prefix here without following it there fails the build rather than silently leaking
// keys.
describe("the redaction rules, given the API key prefixes the app mints", () => {
  const prefixes: [string, string][] = [
    ["API key", API_KEY_PREFIX],
    ["ingest key", INGEST_KEY_PREFIX],
    ["legacy personal access token", LEGACY_PAT_PREFIX],
  ];

  describe("given a token minted by the real generator", () => {
    /** @scenario "A key minted by LangWatch is redacted on its prefix" */
    it.each(prefixes)("redacts a %s", (_label, prefix) => {
      const token = `${prefix}${"a".repeat(16)}_${"b".repeat(48)}`;
      const { text, redactedCount } = redactSecretsInText({
        text: `the key is ${token} and the model is gpt-5-mini`,
      });

      expect(redactedCount).toBeGreaterThan(0);
      expect(text).not.toContain(token);
      expect(text).toContain("the model is gpt-5-mini");
    });
  });

  describe("given only the prefix and a short body", () => {
    // A truncated key in a stack trace or a log line is still key material.
    it.each(prefixes)("redacts a short %s", (_label, prefix) => {
      expect(redactSecretsInText({ text: `${prefix}123af` }).redactedCount).toBe(1);
    });
  });
});
