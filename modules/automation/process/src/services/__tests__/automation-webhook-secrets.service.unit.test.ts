// Webhook secrets are encrypted and redacted with __kept__ marker; this also
// serves as the write protocol (leave alone). Must refuse __kept__ with changed URL.

import { WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/automation-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AutomationWebhookSecretsService } from "../automation-webhook-secrets.service.ts";

/** Reversible and obviously not real, so a leak in a failure message is loud. */
const crypto = {
  encrypt: (plain: string) => `enc(${plain})`,
  decrypt: (cipher: string) => cipher.replace(/^enc\(/, "").replace(/\)$/, ""),
};

const adapter = AutomationWebhookSecretsService.create(crypto as never);

const stored = (over: Record<string, unknown> = {}) =>
  ({
    url: "https://acme.test/hook",
    headersEncrypted: crypto.encrypt(JSON.stringify({ Authorization: "Bearer real-token" })),
    signingSecretEncrypted: crypto.encrypt("whsec_real"),
    ...over,
  }) as never;

describe("AutomationWebhookSecretsService.redact", () => {
  describe("given stored headers and a signing secret", () => {
    it("returns the marker, never the value", () => {
      const redacted = adapter.redact(stored());

      expect(redacted.headers).toEqual({ Authorization: WEBHOOK_HEADER_VALUE_KEPT });
      expect(redacted.signingSecret).toBe(WEBHOOK_HEADER_VALUE_KEPT);
    });

    it("carries no encrypted field out with it", () => {
      // The ciphertext is not a secret the screen needs either, and shipping
      // it would put every stored value one decrypt away from a reader.
      const redacted = adapter.redact(stored());

      expect(Object.keys(redacted)).not.toContain("headersEncrypted");
      expect(Object.keys(redacted)).not.toContain("signingSecretEncrypted");
      expect(Object.keys(redacted)).not.toContain("previousSigningSecretEncrypted");
      expect(JSON.stringify(redacted)).not.toContain("real-token");
      expect(JSON.stringify(redacted)).not.toContain("whsec_real");
    });

    it("keeps the header NAMES, which are not secret and the screen needs", () => {
      const redacted = adapter.redact(
        stored({
          headersEncrypted: crypto.encrypt(JSON.stringify({ "X-Api-Key": "a", "X-Tenant": "b" })),
        }),
      );

      expect(Object.keys(redacted.headers).toSorted()).toEqual(["X-Api-Key", "X-Tenant"]);
    });
  });

  describe("given no signing secret is stored", () => {
    it("says so, rather than showing a marker for one that does not exist", () => {
      const redacted = adapter.redact(stored({ signingSecretEncrypted: undefined }));

      expect(redacted.signingSecret).toBeNull();
    });
  });
});

describe("AutomationWebhookSecretsService.persist", () => {
  describe("given the marker comes back for a header", () => {
    it("keeps the stored value instead of writing the marker", () => {
      const existing = stored();

      const saved = adapter.persist({
        incoming: {
          url: "https://acme.test/hook",
          headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
        } as never,
        existing,
      });

      expect(crypto.decrypt(saved.headersEncrypted ?? "")).toBe(
        JSON.stringify({ Authorization: "Bearer real-token" }),
      );
    });

    it("refuses when the url changed under it", () => {
      // "Leave this one alone" against a new destination would send the old
      // destination's credentials somewhere they were never meant to go.
      expect(() =>
        adapter.persist({
          incoming: {
            url: "https://elsewhere.test/hook",
            headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
          } as never,
          existing: stored(),
        }),
      ).toThrow(/re-enter webhook header values/i);
    });
  });

  describe("given a real value comes back", () => {
    it("stores it encrypted, not in the clear", () => {
      const saved = adapter.persist({
        incoming: {
          url: "https://acme.test/hook",
          headers: { Authorization: "Bearer new-token" },
        } as never,
      });

      expect(Object.keys(saved)).not.toContain("headers");
      expect(saved.headersEncrypted).toBe(
        crypto.encrypt(JSON.stringify({ Authorization: "Bearer new-token" })),
      );
    });

    it("drops a header the customer removed", () => {
      const saved = adapter.persist({
        incoming: { url: "https://acme.test/hook", headers: {} } as never,
        existing: stored(),
      });

      expect(saved.headersEncrypted).toBeUndefined();
    });
  });

  describe("when redacting then persisting round-trips", () => {
    it("survives a save that changed nothing", () => {
      const first = stored();
      const backToTheScreen = adapter.redact(first);
      const saved = adapter.persist({ incoming: backToTheScreen, existing: first });

      expect(adapter.decryptHeaders(saved)).toEqual({ Authorization: "Bearer real-token" });
    });
  });
});

describe("AutomationWebhookSecretsService.decryptSigningSecrets", () => {
  const now = Temporal.Instant.from("2026-08-31T12:00:00.000Z");

  describe("given only a current secret", () => {
    it("answers with that one", () => {
      expect(
        adapter.decryptSigningSecrets({ signingSecretEncrypted: crypto.encrypt("a") }, now),
      ).toEqual(["a"]);
    });
  });

  describe("given a previous secret still inside its rotation window", () => {
    it("answers with both, so a receiver mid-rotation still verifies", () => {
      expect(
        adapter.decryptSigningSecrets(
          {
            signingSecretEncrypted: crypto.encrypt("new"),
            previousSigningSecretEncrypted: crypto.encrypt("old"),
            previousSigningSecretExpiresAt: now.epochMilliseconds + 60_000,
          },
          now,
        ),
      ).toEqual(["new", "old"]);
    });
  });

  describe("given the rotation window has closed", () => {
    it("drops the old one, so a retired secret stops verifying", () => {
      expect(
        adapter.decryptSigningSecrets(
          {
            signingSecretEncrypted: crypto.encrypt("new"),
            previousSigningSecretEncrypted: crypto.encrypt("old"),
            previousSigningSecretExpiresAt: now.epochMilliseconds - 1,
          },
          now,
        ),
      ).toEqual(["new"]);
    });
  });

  describe("given nothing is stored", () => {
    it("answers with none rather than an empty string", () => {
      expect(adapter.decryptSigningSecrets({}, now)).toEqual([]);
    });
  });
});
