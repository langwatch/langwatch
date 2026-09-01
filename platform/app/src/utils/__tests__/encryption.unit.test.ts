/**
 * The at-rest format for a stored credential, pinned on this side of it.
 *
 * The format is described twice in this repository — here, and by
 * `AesGcmSecretEncryptionAdapter` in `@langwatch/secret-server`, which is what
 * a process composing the packaged secret service uses. That is not an
 * oversight and it is not free: rows written by one process are read by the
 * other, so a change to either description that the other does not follow
 * loses customer credentials.
 *
 * It is two descriptions because the repository's package-boundaries rule says
 * a feature server package may be imported only by a composition root, and
 * this module is a leaf that forty others depend on. Collapsing it to one
 * means moving those callers to composition roots, which is its own change.
 *
 * Until then, both descriptions are nailed to the SAME recorded row below:
 * the identical constants appear in
 * `packages/features/secret/server/src/adapters/__tests__/aes-gcm.secret-encryption.adapter.unit.test.ts`,
 * so a format change on either side turns one of the two suites red rather
 * than turning up in production as a value that will not decrypt.
 */
import { describe, expect, it, vi } from "vitest";

const { KEY } = vi.hoisted(() => ({ KEY: "0f".repeat(32) }));

vi.mock("~/env.mjs", () => ({ env: { CREDENTIALS_SECRET: KEY } }));

import { decrypt, encrypt } from "~/utils/encryption";

/** One row, exactly as this module wrote it, under {@link KEY}. */
const STORED_ROW =
  "aabbccddeeff001122334455:72b43a4bc9e43c4de7e3e7ed18f9dbe02327fe68fd:59a8bc427deba94b3e94aa08ce8ab785";
const STORED_VALUE = "sk-live-fixture-value";

describe("stored-credential encryption", () => {
  describe("given a row recorded under the configured key", () => {
    it("reads it back, which is what makes the two descriptions one format", () => {
      expect(decrypt(STORED_ROW)).toBe(STORED_VALUE);
    });
  });

  describe("given a value this module writes", () => {
    it("reads it back unchanged", () => {
      expect(decrypt(encrypt("sk-live-abc123"))).toBe("sk-live-abc123");
    });

    it("writes the three-part hex shape the packaged cipher also writes", () => {
      const [iv, payload, authTag] = encrypt("value").split(":");

      expect(iv).toMatch(/^[0-9a-f]{24}$/);
      expect(payload).toMatch(/^[0-9a-f]+$/);
      expect(authTag).toMatch(/^[0-9a-f]{32}$/);
    });

    it("keeps the plaintext out of what it stores", () => {
      expect(encrypt("sk-live-abc123")).not.toContain("sk-live-abc123");
    });
  });

  describe("when the stored value has been altered", () => {
    it("refuses the read rather than returning part of it", () => {
      const [iv, payload, authTag] = encrypt("sk-live-abc123").split(":");
      const flipped = `${payload!.slice(0, -2)}${payload!.slice(-2) === "00" ? "11" : "00"}`;

      expect(() => decrypt(`${iv}:${flipped}:${authTag}`)).toThrow(
        "Failed to decrypt: Data may be corrupted or tampered with",
      );
    });

    it("says the format is wrong when it is not three parts at all", () => {
      expect(() => decrypt("plaintext")).toThrow("Invalid encrypted string format");
    });
  });
});
