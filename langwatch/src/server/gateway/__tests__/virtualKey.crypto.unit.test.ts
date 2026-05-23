import { beforeEach, describe, expect, it } from "vitest";

import {
  VIRTUAL_KEY_DISPLAY_PREFIX_LENGTH,
  VirtualKeyCryptoError,
  hashVirtualKeySecret,
  mintUlid,
  mintVirtualKeySecret,
  parseVirtualKey,
  verifyVirtualKeySecret,
} from "../virtualKey.crypto";

beforeEach(() => {
  process.env.LW_VIRTUAL_KEY_PEPPER = "unit-test-pepper-32-bytes-exactly!";
});

describe("virtual key crypto", () => {
  describe("mintUlid", () => {
    it("returns 26 Crockford base32 characters", () => {
      const ulid = mintUlid();
      expect(ulid).toHaveLength(26);
      expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    });

    it("is time-sortable — later timestamps produce lexically larger IDs", () => {
      const a = mintUlid(1_000_000);
      const b = mintUlid(2_000_000);
      expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    });
  });

  describe("mintVirtualKeySecret", () => {
    it("produces vk-lw-<26-ulid> (32 chars)", () => {
      const secret = mintVirtualKeySecret();
      expect(secret).toMatch(/^vk-lw-[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(secret).toHaveLength(32);
    });

    it("does not encode env in the token (env is metadata on the row)", () => {
      const secret = mintVirtualKeySecret();
      expect(secret).not.toMatch(/live|test/);
    });
  });

  describe("parseVirtualKey", () => {
    it("extracts ulid and displayPrefix", () => {
      const secret = mintVirtualKeySecret(1_735_000_000_000);
      const parsed = parseVirtualKey(secret);
      expect(parsed.ulid).toHaveLength(26);
      expect(parsed.displayPrefix).toHaveLength(
        VIRTUAL_KEY_DISPLAY_PREFIX_LENGTH,
      );
      expect(parsed.displayPrefix.startsWith("vk-lw-")).toBe(true);
    });

    describe("when the key is malformed", () => {
      it("rejects a secret without the vk-lw- prefix", () => {
        expect(() => parseVirtualKey("sk-live-abcdef")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects a legacy lw_vk_ token (clean break, no backcompat)", () => {
        expect(() =>
          parseVirtualKey("lw_vk_live_01H000000000000000000000"),
        ).toThrow(VirtualKeyCryptoError);
      });

      it("rejects a ulid shorter than 26 chars", () => {
        expect(() => parseVirtualKey("vk-lw-ABC")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects a ulid with non-Crockford characters", () => {
        expect(() =>
          parseVirtualKey("vk-lw-!!!!!!!!!!!!!!!!!!!!!!!!!!"),
        ).toThrow(VirtualKeyCryptoError);
      });
    });
  });

  describe("hashVirtualKeySecret", () => {
    /** @scenario Virtual key secret is stored as peppered HMAC-SHA256 hash */
    it("produces a 64-char hex sha256 hash", () => {
      const secret = mintVirtualKeySecret();
      const hash = hashVirtualKeySecret(secret);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic — same input always yields same hash", () => {
      const secret = mintVirtualKeySecret();
      expect(hashVirtualKeySecret(secret)).toBe(hashVirtualKeySecret(secret));
    });

    it("changes with the pepper", () => {
      const secret = mintVirtualKeySecret();
      const first = hashVirtualKeySecret(secret);
      process.env.LW_VIRTUAL_KEY_PEPPER = "totally-different-pepper-32-bytes!";
      const second = hashVirtualKeySecret(secret);
      expect(first).not.toBe(second);
    });

    describe("when the pepper is missing", () => {
      it("throws pepper_missing", () => {
        delete process.env.LW_VIRTUAL_KEY_PEPPER;
        expect(() => hashVirtualKeySecret("vk-lw-x")).toThrow(
          /LW_VIRTUAL_KEY_PEPPER/,
        );
      });
    });
  });

  describe("verifyVirtualKeySecret", () => {
    it("returns true for a matching secret / hash pair", () => {
      const secret = mintVirtualKeySecret();
      const hash = hashVirtualKeySecret(secret);
      expect(verifyVirtualKeySecret(secret, hash)).toBe(true);
    });

    it("returns false for a non-matching secret", () => {
      const hash = hashVirtualKeySecret(mintVirtualKeySecret());
      expect(
        verifyVirtualKeySecret(mintVirtualKeySecret(), hash),
      ).toBe(false);
    });

    it("returns false for a mismatched hex length", () => {
      const secret = mintVirtualKeySecret();
      expect(verifyVirtualKeySecret(secret, "abcd")).toBe(false);
    });
  });
});
