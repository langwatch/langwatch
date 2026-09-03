import { describe, expect, it } from "vitest";
import { AesGcmSecretEncryptionAdapter } from "../aes-gcm.secret-encryption.adapter";

const KEY = "0f".repeat(32);
const OTHER_KEY = "a1".repeat(32);

/**
 * One row as the platform app's own routine wrote it: key {@link KEY}, a fixed
 * IV, and the value below.
 *
 * It is here because the format is not this class's to choose. Rows encrypted
 * long ago sit in customer databases, and a change that round-trips with
 * itself while failing to read them would pass every other test in this file.
 * The identical constants are asserted from the other side in
 * `platform/app/src/utils/__tests__/encryption.unit.test.ts`, which is what
 * keeps the two descriptions of this format one format.
 */
const STORED_ROW =
  "aabbccddeeff001122334455:72b43a4bc9e43c4de7e3e7ed18f9dbe02327fe68fd:59a8bc427deba94b3e94aa08ce8ab785";
const STORED_VALUE = "sk-live-fixture-value";

function cipher(key = KEY): AesGcmSecretEncryptionAdapter {
  return AesGcmSecretEncryptionAdapter.create({ key });
}

describe("AesGcmSecretEncryptionAdapter", () => {
  describe("given a key of the wrong shape", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("refuses at construction rather than at the first secret read", () => {
      expect(() => cipher("")).toThrow(/32-byte hex key/);
      expect(() => cipher("0f".repeat(16))).toThrow(/32-byte hex key/);
      expect(() => cipher("0f".repeat(64))).toThrow(/32-byte hex key/);
      expect(() => cipher("not-hex-at-all")).toThrow(/32-byte hex key/);
    });
  });

  describe("given a value written by this cipher", () => {
    /** @scenario "Encrypted keys are decrypted on read" */
    it("reads it back unchanged", () => {
      const encrypted = cipher().encrypt("sk-live-abc123");

      expect(cipher().decrypt(encrypted)).toBe("sk-live-abc123");
    });

    /** @scenario "New model provider keys are encrypted on save" */
    it("writes the three-part hex format the stored column holds", () => {
      const stored = cipher().encrypt('{"OPENAI_API_KEY":"sk-live-abc123"}');
      const [iv, payload, authTag] = stored.split(":");

      expect(iv).toMatch(/^[0-9a-f]{24}$/);
      expect(payload).toMatch(/^[0-9a-f]+$/);
      expect(authTag).toMatch(/^[0-9a-f]{32}$/);
      // A reader that still expects the legacy plaintext column would parse
      // this as JSON; it must fail rather than half-succeed.
      expect(() => JSON.parse(stored)).toThrow();
    });

    it("never writes the same ciphertext twice, so equal secrets do not look equal", () => {
      const first = cipher().encrypt("same-value");
      const second = cipher().encrypt("same-value");

      expect(first).not.toBe(second);
      expect(first.split(":")[0]).not.toBe(second.split(":")[0]);
    });

    /** @scenario "New model provider keys are encrypted on save" */
    it("keeps the plaintext out of what it stores", () => {
      expect(cipher().encrypt("sk-live-abc123")).not.toContain("sk-live-abc123");
    });
  });

  describe("given a row written before this class existed", () => {
    /** @scenario "One at-rest format for every process" */
    it("reads it, because the at-rest format is not this class's to change", () => {
      expect(cipher().decrypt(STORED_ROW)).toBe(STORED_VALUE);
    });
  });

  describe("when the key is not the key the value was written under", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("refuses the read instead of returning something", () => {
      const encrypted = cipher().encrypt("sk-live-abc123");

      expect(() => cipher(OTHER_KEY).decrypt(encrypted)).toThrow(
        "Failed to decrypt: Data may be corrupted or tampered with",
      );
      expect(() => cipher(OTHER_KEY).decrypt(STORED_ROW)).toThrow(
        "Failed to decrypt: Data may be corrupted or tampered with",
      );
    });
  });

  describe("when the stored value has been altered", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("refuses a payload whose authentication tag no longer matches", () => {
      const [iv, payload, authTag] = cipher().encrypt("sk-live-abc123").split(":");
      const flipped = `${payload!.slice(0, -2)}${payload!.slice(-2) === "00" ? "11" : "00"}`;

      expect(() => cipher().decrypt(`${iv}:${flipped}:${authTag}`)).toThrow(
        "Failed to decrypt: Data may be corrupted or tampered with",
      );
    });

    it("refuses a tag lifted from another value", () => {
      const [iv, payload] = cipher().encrypt("sk-live-abc123").split(":");
      const [, , otherTag] = cipher().encrypt("a-different-secret").split(":");

      expect(() => cipher().decrypt(`${iv}:${payload}:${otherTag}`)).toThrow(
        "Failed to decrypt: Data may be corrupted or tampered with",
      );
    });
  });

  describe("when the stored value is not this format at all", () => {
    it("says the format is wrong rather than blaming the data", () => {
      expect(() => cipher().decrypt("plaintext")).toThrow("Invalid encrypted string format");
      expect(() => cipher().decrypt("only:two")).toThrow("Invalid encrypted string format");
      expect(() => cipher().decrypt("")).toThrow("Invalid encrypted string format");
    });
  });
});
