import { describe, expect, it, vi } from "vitest";

// Fake cipher so the test exercises the secret module's orchestration
// (resolve-kept / encrypt / redact / decrypt), not AES itself.
vi.mock("~/utils/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import { WEBHOOK_HEADER_VALUE_KEPT } from "~/shared/automations/providers/webhook";
import {
  decryptWebhookHeaders,
  persistWebhookActionParams,
  redactWebhookActionParams,
} from "../server";

const BASE = {
  url: "https://example.com/hook",
  method: "POST" as const,
  bodyTemplate: null,
};

describe("persistWebhookActionParams", () => {
  describe("when all header values are freshly typed", () => {
    it("encrypts the record and drops the plaintext", () => {
      const stored = persistWebhookActionParams({
        incoming: { ...BASE, headers: { Authorization: "Bearer secret" } },
      });
      expect(stored.headers).toBeUndefined();
      expect(stored.headersEncrypted).toBe(
        `enc(${JSON.stringify({ Authorization: "Bearer secret" })})`,
      );
    });
  });

  describe("when a value carries the kept sentinel", () => {
    it("resolves it from the saved ciphertext", () => {
      const existing = persistWebhookActionParams({
        incoming: {
          ...BASE,
          headers: { Authorization: "Bearer old", "X-Api": "k1" },
        },
      });
      const stored = persistWebhookActionParams({
        incoming: {
          ...BASE,
          headers: {
            Authorization: WEBHOOK_HEADER_VALUE_KEPT,
            "X-Api": "k2",
          },
        },
        existing,
      });
      expect(decryptWebhookHeaders(stored)).toEqual({
        Authorization: "Bearer old",
        "X-Api": "k2",
      });
    });

    it("drops a kept value whose name has no stored counterpart", () => {
      const stored = persistWebhookActionParams({
        incoming: {
          ...BASE,
          headers: { "X-Renamed": WEBHOOK_HEADER_VALUE_KEPT },
        },
        existing: persistWebhookActionParams({
          incoming: { ...BASE, headers: { "X-Original": "v" } },
        }),
      });
      expect(decryptWebhookHeaders(stored)).toEqual({});
    });

    it("refuses to carry a saved secret to a changed destination", () => {
      const existing = persistWebhookActionParams({
        incoming: {
          ...BASE,
          headers: { Authorization: "Bearer old" },
        },
      });

      expect(() =>
        persistWebhookActionParams({
          incoming: {
            ...BASE,
            url: "https://attacker.example/collect",
            headers: { Authorization: WEBHOOK_HEADER_VALUE_KEPT },
          },
          existing,
        }),
      ).toThrow(/Re-enter webhook header values/);
    });
  });

  describe("when no headers remain", () => {
    it("stores no ciphertext at all", () => {
      const stored = persistWebhookActionParams({
        incoming: { ...BASE, headers: {} },
      });
      expect(stored.headersEncrypted).toBeUndefined();
    });
  });
});

describe("redactWebhookActionParams", () => {
  it("echoes header names with the kept sentinel and strips the ciphertext", () => {
    const stored = persistWebhookActionParams({
      incoming: { ...BASE, headers: { Authorization: "Bearer secret" } },
    });
    const redacted = redactWebhookActionParams(stored);
    expect(redacted.headers).toEqual({
      Authorization: WEBHOOK_HEADER_VALUE_KEPT,
    });
    expect(JSON.stringify(redacted)).not.toContain("Bearer secret");
    expect(JSON.stringify(redacted)).not.toContain("enc(");
  });

  it("passes non-header fields through", () => {
    const redacted = redactWebhookActionParams({ ...BASE });
    expect(redacted).toMatchObject({ ...BASE, headers: {} });
  });
});

describe("decryptWebhookHeaders", () => {
  it("returns an empty record when nothing is stored", () => {
    expect(decryptWebhookHeaders({})).toEqual({});
  });

  it("falls back to a legacy plaintext record", () => {
    expect(decryptWebhookHeaders({ headers: { "X-Api": "k" } })).toEqual({
      "X-Api": "k",
    });
  });
});
