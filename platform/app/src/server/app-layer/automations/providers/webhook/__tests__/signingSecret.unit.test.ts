import { describe, expect, it, vi } from "vitest";

// Fake cipher so the test exercises the secret module's orchestration
// (resolve-kept / rotate / encrypt / redact / decrypt), not AES itself.
vi.mock("~/utils/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import { WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/automations/providers/webhook";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "~/server/webhooks/signature";
import {
  decryptWebhookSigningSecrets,
  persistWebhookActionParams,
  redactWebhookActionParams,
} from "../server";

/**
 * Opt-in HMAC signing for the automations channel (ADR-040 §3). The scheme and
 * its implementation already shipped with the endpoints platform; what was
 * missing was any way for a trigger to hand it a secret, so every webhook
 * automation went out unsigned and a receiver could not tell a LangWatch
 * delivery from anyone who learned the URL.
 */

const BASE = {
  url: "https://example.com/hook",
  method: "POST" as const,
  bodyTemplate: null,
  headers: {},
};

describe("the automations signing secret", () => {
  describe("when no secret is configured", () => {
    it("stores nothing and signs nothing, which is the pre-existing behavior", () => {
      const stored = persistWebhookActionParams({ incoming: { ...BASE } });
      expect(stored.signingSecretEncrypted).toBeUndefined();
      expect(decryptWebhookSigningSecrets(stored)).toEqual([]);
    });

    it("reports no secret to the drawer", () => {
      const stored = persistWebhookActionParams({ incoming: { ...BASE } });
      expect(redactWebhookActionParams(stored).signingSecret).toBeNull();
    });
  });

  describe("when a secret is typed", () => {
    it("encrypts it and never keeps the plaintext", () => {
      const stored = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      expect(stored.signingSecretEncrypted).toBe("enc(whsec_first)");
      expect(JSON.stringify(stored)).not.toContain('"signingSecret"');
      expect(decryptWebhookSigningSecrets(stored)).toEqual(["whsec_first"]);
    });

    it("returns the sentinel to the drawer instead of the value", () => {
      const stored = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const redacted = redactWebhookActionParams(stored);
      expect(redacted.signingSecret).toBe(WEBHOOK_HEADER_VALUE_KEPT);
      expect(JSON.stringify(redacted)).not.toContain("whsec_first");
    });
  });

  describe("when the drawer saves without touching the field", () => {
    it("round-trips the sentinel and keeps the stored secret", () => {
      const existing = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const stored = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: WEBHOOK_HEADER_VALUE_KEPT },
        existing,
      });
      expect(stored.signingSecretEncrypted).toBe("enc(whsec_first)");
      expect(decryptWebhookSigningSecrets(stored)).toEqual(["whsec_first"]);
    });

    it("keeps an in-flight rotation window intact", () => {
      const first = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const rotated = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_second" },
        existing: first,
      });
      const resaved = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: WEBHOOK_HEADER_VALUE_KEPT },
        existing: rotated,
      });
      expect(decryptWebhookSigningSecrets(resaved)).toEqual([
        "whsec_second",
        "whsec_first",
      ]);
    });
  });

  describe("when a different secret is typed over a stored one", () => {
    it("signs with both while the old one's window is open, newest first", () => {
      const first = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const rotated = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_second" },
        existing: first,
      });
      expect(decryptWebhookSigningSecrets(rotated)).toEqual([
        "whsec_second",
        "whsec_first",
      ]);
    });

    it("drops the old one once its window closes", () => {
      const first = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const rotated = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_second" },
        existing: first,
      });
      const afterWindow = new Date(
        Date.now() + WEBHOOK_PREVIOUS_SECRET_TTL_MS + 1000,
      );
      expect(decryptWebhookSigningSecrets(rotated, afterWindow)).toEqual([
        "whsec_second",
      ]);
    });

    it("opens no window when the same value is submitted again", () => {
      const first = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const resaved = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
        existing: first,
      });
      expect(resaved.previousSigningSecretEncrypted).toBeUndefined();
      expect(decryptWebhookSigningSecrets(resaved)).toEqual(["whsec_first"]);
    });
  });

  describe("when the field is cleared", () => {
    it("stops signing and drops the old secret with it", () => {
      const first = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_first" },
      });
      const rotated = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: "whsec_second" },
        existing: first,
      });
      const cleared = persistWebhookActionParams({
        incoming: { ...BASE, signingSecret: null },
        existing: rotated,
      });
      expect(cleared.signingSecretEncrypted).toBeUndefined();
      expect(cleared.previousSigningSecretEncrypted).toBeUndefined();
      expect(decryptWebhookSigningSecrets(cleared)).toEqual([]);
    });
  });
});
