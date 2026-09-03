/**
 * A webhook action's secrets, on the way in and on the way back out.
 *
 * Header values and the signing secret are customer secrets. They are stored
 * encrypted, and what comes back to the settings screen is the marker
 * `__kept__` rather than the value — so the screen can show that a header
 * exists without ever handing it back. If that redaction stopped happening,
 * every read of an automation would return the secrets in plaintext.
 *
 * The marker doubles as the write protocol: a form that submits `__kept__`
 * back is saying "leave this one alone". That makes the redact/persist pair a
 * round trip, and the one case it must refuse is a `__kept__` arriving
 * alongside a CHANGED url — because "leave it alone" would then silently send
 * the old destination's credentials to a new one.
 */

import { describe, expect, it } from "vitest";
import { WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/automation-contract";
import { WebhookProviderAdapter } from "../webhook-provider.adapter";

/** Reversible and obviously not real, so a leak in a failure message is loud. */
const crypto = {
  encrypt: (plain: string) => `enc(${plain})`,
  decrypt: (cipher: string) => cipher.replace(/^enc\(/, "").replace(/\)$/, ""),
};

const adapter = WebhookProviderAdapter.create(crypto as never);

const stored = (over: Record<string, unknown> = {}) =>
  ({
    url: "https://acme.test/hook",
    headersEncrypted: crypto.encrypt(JSON.stringify({ Authorization: "Bearer real-token" })),
    signingSecretEncrypted: crypto.encrypt("whsec_real"),
    ...over,
  }) as never;

describe("WebhookProviderAdapter.redact", () => {
  describe("given stored headers and a signing secret", () => {
    it("returns the marker, never the value", () => {
      const redacted = adapter.redact(stored()) as unknown as {
        headers: Record<string, string>;
        signingSecret: string | null;
      };

      expect(redacted.headers).toEqual({ Authorization: WEBHOOK_HEADER_VALUE_KEPT });
      expect(redacted.signingSecret).toBe(WEBHOOK_HEADER_VALUE_KEPT);
    });

    it("carries no encrypted field out with it", () => {
      // The ciphertext is not a secret the screen needs either, and shipping
      // it would put every stored value one decrypt away from a reader.
      const redacted = adapter.redact(stored()) as unknown as Record<string, unknown>;

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
      ) as unknown as { headers: Record<string, string> };

      expect(Object.keys(redacted.headers).sort()).toEqual(["X-Api-Key", "X-Tenant"]);
    });
  });

  describe("given no signing secret is stored", () => {
    it("says so, rather than showing a marker for one that does not exist", () => {
      const redacted = adapter.redact(stored({ signingSecretEncrypted: undefined })) as unknown as {
        signingSecret: string | null;
      };

      expect(redacted.signingSecret).toBeNull();
    });
  });
});

describe("WebhookProviderAdapter.persist", () => {
  describe("given the marker comes back for a header", () => {
    it("keeps the stored value instead of writing the marker", () => {
      const existing = stored();

      const saved = adapter.persist({
        incoming: {
          url: "https://acme.test/hook",
          headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
        } as never,
        existing,
      }) as unknown as { headersEncrypted?: string };

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
      }) as unknown as Record<string, unknown>;

      expect(Object.keys(saved)).not.toContain("headers");
      expect(saved.headersEncrypted).toBe(
        crypto.encrypt(JSON.stringify({ Authorization: "Bearer new-token" })),
      );
    });

    it("drops a header the customer removed", () => {
      const saved = adapter.persist({
        incoming: { url: "https://acme.test/hook", headers: {} } as never,
        existing: stored(),
      }) as unknown as { headersEncrypted?: string };

      expect(saved.headersEncrypted).toBeUndefined();
    });
  });

  describe("the round trip", () => {
    it("survives a save that changed nothing", () => {
      const first = stored();
      const backToTheScreen = adapter.redact(first);
      const saved = adapter.persist({ incoming: backToTheScreen, existing: first });

      expect(adapter.decryptHeaders(saved)).toEqual({ Authorization: "Bearer real-token" });
    });
  });
});

describe("WebhookProviderAdapter.decryptSigningSecrets", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");

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
            previousSigningSecretExpiresAt: now.getTime() + 60_000,
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
            previousSigningSecretExpiresAt: now.getTime() - 1,
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
