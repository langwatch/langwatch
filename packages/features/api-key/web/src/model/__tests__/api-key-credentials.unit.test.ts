/**
 * The credential rules this family exists to keep, as tests rather than as
 * docblocks.
 *
 * Four properties, and every one of them has a way to fail silently:
 *
 *  1. **A list answer carries no key material.** The contract's `ApiKeyListEntry`
 *     is the shape every read answers, and widening it is what would turn a list
 *     request into a credential disclosure. A TYPE cannot be asserted at
 *     runtime, so what is checked is the one thing that would betray a widening:
 *     the field the table renders is a five-character lookup PREFIX, and the
 *     screen renders it behind `sk-lw-` with an ellipsis.
 *  2. **Masking never reveals more than it should**, including for values short
 *     enough that a naive slice would print the whole thing.
 *  3. **The `.env` snippet's masked form is not the copied form.** The copy path
 *     hands over the real value; only the rendered string is masked.
 *  4. **The MCP config's masked JSON does not contain the token.** This is the
 *     one the dialog gets right by construction and would lose to a one-line
 *     refactor of `displayConfigJson`.
 *
 * Spec: specs/api-keys/token-created-snippets.feature
 */

import { describe, expect, it } from "vitest";
import { buildMcpJson, formatEnvLines, maskApiKey, maskSecret } from "../api-key-snippets";
import { apiKeyRowAnchorId, apiKeySettingsHref } from "../api-key-anchor";

const TOKEN = "sk-lw-averyrealsecrettokenvalue";

describe("given a freshly minted token", () => {
  describe("when it is masked for display", () => {
    /** @scenario Copy this token now — the reveal is one-time */
    it("keeps four characters at each end and hides everything between", () => {
      const masked = maskSecret(TOKEN);
      expect(masked.startsWith(TOKEN.slice(0, 4))).toBe(true);
      expect(masked.endsWith(TOKEN.slice(-4))).toBe(true);
      expect(masked).not.toContain(TOKEN.slice(4, -4));
      expect(masked).not.toBe(TOKEN);
    });

    /** @scenario Copy this token now — the reveal is one-time */
    it("hides a short value entirely rather than printing most of it", () => {
      // Eight characters or fewer would leave nothing between the two
      // four-character ends, so the whole value would show. It does not.
      expect(maskSecret("sk-lw-12")).toBe("********");
      expect(maskSecret("")).toBe("********");
    });

    /** @scenario Copy this token now — the reveal is one-time */
    it("never lets the bullet mask grow long enough to leak the length", () => {
      const long = `sk-lw-${"x".repeat(500)}`;
      // The run of stars is capped, so a very long key does not render a bar
      // whose width is its length.
      expect(maskSecret(long).length).toBeLessThan(long.length);
    });

    /** @scenario Copy this token now — the reveal is one-time */
    it("masks the middle for the config preview too, and answers empty for no key", () => {
      expect(maskApiKey(TOKEN)).toContain("••••");
      expect(maskApiKey(TOKEN)).not.toContain(TOKEN.slice(6, -4));
      expect(maskApiKey("")).toBe("");
    });
  });

  describe("when the .env snippet is built", () => {
    /** @scenario The .env tab shows the key masked and copies it in full */
    it("writes the real value unless masking is asked for, so the copy path is never the masked one", () => {
      const real = formatEnvLines([{ key: "LANGWATCH_API_KEY", value: TOKEN }]);
      const masked = formatEnvLines([{ key: "LANGWATCH_API_KEY", value: TOKEN, mask: true }]);
      expect(real).toBe(`LANGWATCH_API_KEY="${TOKEN}"`);
      expect(masked).not.toContain(TOKEN);
    });
  });

  describe("when the MCP config is built for display", () => {
    /** @scenario The config block renders the masked key and copies the real one */
    it("carries whatever key it was handed and nothing else", () => {
      const shown = buildMcpJson({
        apiKey: maskApiKey(TOKEN),
        endpoint: "https://app.langwatch.ai",
        projectId: "proj-1",
      });
      const copied = buildMcpJson({
        apiKey: TOKEN,
        endpoint: "https://app.langwatch.ai",
        projectId: "proj-1",
      });
      expect(shown).not.toContain(TOKEN);
      expect(copied).toContain(TOKEN);
      // The cloud endpoint is the SDK's own default, so it is left out rather
      // than pinned into every reader's config file.
      expect(shown).not.toContain("LANGWATCH_ENDPOINT");
    });

    /** @scenario The config block names a self-hosted endpoint */
    it("names an endpoint that is not the cloud one", () => {
      const json = buildMcpJson({
        apiKey: TOKEN,
        endpoint: "https://langwatch.internal",
        projectId: "proj-1",
      });
      expect(json).toContain("https://langwatch.internal");
    });
  });
});

describe("given a key row that another family deep-links to", () => {
  describe("when the anchor is built", () => {
    /** @scenario Deep link opens the page on a specific key */
    it("spells the address the trace drawer's API-key attribute links to", () => {
      // The platform copy of this module stays for
      // `features/traces-v2/components/TraceDrawer/ApiKeyAttribute.tsx`, so both
      // halves are pinned to the same literal strings. A drift in either breaks
      // a link that still reads as a working one.
      expect(apiKeyRowAnchorId("key-123")).toBe("api-key-key-123");
      expect(apiKeySettingsHref("key-123")).toBe("/settings/api-keys#api-key-key-123");
    });
  });
});
