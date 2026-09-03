import { describe, expect, it } from "vitest";

import { VirtualKeyCryptoAdapter, VirtualKeyCryptoError } from "../index";

const crypto = VirtualKeyCryptoAdapter.create({
  pepper: "unit-test-pepper-32-bytes-exactly!",
});

describe("virtual key crypto", () => {
  describe("mintUlid", () => {
    it("returns 26 Crockford base32 characters", () => {
      const ulid = VirtualKeyCryptoAdapter.mintUlid();
      expect(ulid).toHaveLength(26);
      expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    });

    it("is time-sortable — later timestamps produce lexically larger IDs", () => {
      const a = VirtualKeyCryptoAdapter.mintUlid(1_000_000);
      const b = VirtualKeyCryptoAdapter.mintUlid(2_000_000);
      expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    });
  });

  describe("mintSecret", () => {
    it("produces vk-lw-<26-ulid> (32 chars)", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      expect(secret).toMatch(/^vk-lw-[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(secret).toHaveLength(32);
    });

    it("does not encode env in the token (env is metadata on the row)", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      expect(secret).not.toMatch(/live|test/);
    });
  });

  describe("parseSecret", () => {
    it("extracts ulid and displayPrefix", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret(1_735_000_000_000);
      const parsed = VirtualKeyCryptoAdapter.parseSecret(secret);
      expect(parsed.ulid).toHaveLength(26);
      expect(parsed.displayPrefix).toHaveLength(VirtualKeyCryptoAdapter.displayPrefixLength);
      expect(parsed.displayPrefix.startsWith("vk-lw-")).toBe(true);
    });

    describe("when the key is malformed", () => {
      it("rejects a secret without the vk-lw- prefix", () => {
        expect(() => VirtualKeyCryptoAdapter.parseSecret("sk-live-abcdef")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects a legacy lw_vk_ token (clean break, no backcompat)", () => {
        expect(() =>
          VirtualKeyCryptoAdapter.parseSecret("lw_vk_live_01H000000000000000000000"),
        ).toThrow(VirtualKeyCryptoError);
      });

      it("rejects a ulid shorter than 26 chars", () => {
        expect(() => VirtualKeyCryptoAdapter.parseSecret("vk-lw-ABC")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects a ulid with non-Crockford characters", () => {
        expect(() =>
          VirtualKeyCryptoAdapter.parseSecret("vk-lw-!!!!!!!!!!!!!!!!!!!!!!!!!!"),
        ).toThrow(VirtualKeyCryptoError);
      });
    });
  });

  describe("hashSecret", () => {
    /** @scenario Virtual key secret is stored as peppered HMAC-SHA256 hash */
    it("produces a 64-char hex sha256 hash", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      const hash = crypto.hashSecret(secret);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic — same input always yields same hash", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      expect(crypto.hashSecret(secret)).toBe(crypto.hashSecret(secret));
    });

    it("changes with the pepper", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      const first = crypto.hashSecret(secret);
      const second = VirtualKeyCryptoAdapter.create({
        pepper: "totally-different-pepper-32-bytes!",
      }).hashSecret(secret);
      expect(first).not.toBe(second);
    });

    describe("when the pepper is missing", () => {
      it("throws pepper_missing", () => {
        const unconfigured = VirtualKeyCryptoAdapter.create({});
        expect(() => unconfigured.hashSecret("vk-lw-x")).toThrow(/LW_VIRTUAL_KEY_PEPPER/);
      });
    });
  });

  describe("verifySecret", () => {
    it("returns true for a matching secret / hash pair", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      const hash = crypto.hashSecret(secret);
      expect(crypto.verifySecret(secret, hash)).toBe(true);
    });

    it("returns false for a non-matching secret", () => {
      const hash = crypto.hashSecret(VirtualKeyCryptoAdapter.mintSecret());
      expect(crypto.verifySecret(VirtualKeyCryptoAdapter.mintSecret(), hash)).toBe(false);
    });

    it("returns false for a mismatched hex length", () => {
      const secret = VirtualKeyCryptoAdapter.mintSecret();
      expect(crypto.verifySecret(secret, "abcd")).toBe(false);
    });
  });
});
