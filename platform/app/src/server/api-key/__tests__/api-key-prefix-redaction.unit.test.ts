import { redactSecretsInText } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";

import {
  API_KEY_PREFIX,
  generateApiKeyToken,
  INGEST_KEY_PREFIX,
  LEGACY_PAT_PREFIX,
} from "../api-key-token.utils";

/**
 * The redaction package lists our own key prefixes as known vendor prefixes, and
 * has to duplicate the literals to do it: `@langwatch/redaction` ships inside
 * the SDK and stays dependency-free, so it cannot import from the app.
 *
 * This is the seam that keeps the duplicate honest. It mints a token the real
 * way and asserts the scrubber recognises it, so renaming a prefix here without
 * following it there fails the build rather than quietly un-redacting every
 * LangWatch key in a transcript.
 */
describe("the redaction rules, given the API key prefixes the app mints", () => {
  const prefixes: Array<[string, string]> = [
    ["API key", API_KEY_PREFIX],
    ["ingest key", INGEST_KEY_PREFIX],
    ["legacy personal access token", LEGACY_PAT_PREFIX],
  ];

  describe("given a token minted by the real generator", () => {
    /** @scenario "A key minted by LangWatch is redacted on its prefix" */
    it.each(prefixes)("redacts a %s", (_label, prefix) => {
      const { token } = generateApiKeyToken({ prefix });
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
      expect(
        redactSecretsInText({ text: `${prefix}123af` }).redactedCount,
      ).toBe(1);
    });
  });
});
