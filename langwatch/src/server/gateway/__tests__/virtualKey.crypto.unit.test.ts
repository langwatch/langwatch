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
    describe("when env is live", () => {
      it("produces lw_vk_live_<26-ulid> (37 chars)", () => {
        const secret = mintVirtualKeySecret("live");
        expect(secret).toMatch(/^lw_vk_live_[0-9A-HJKMNP-TV-Z]{26}$/);
        expect(secret).toHaveLength(37);
      });
    });

    describe("when env is test", () => {
      it("produces lw_vk_test_<26-ulid>", () => {
        const secret = mintVirtualKeySecret("test");
        expect(secret.startsWith("lw_vk_test_")).toBe(true);
      });
    });
  });

  describe("parseVirtualKey", () => {
    it("extracts env, ulid, and displayPrefix from a live key", () => {
      const secret = mintVirtualKeySecret("live", 1_735_000_000_000);
      const parsed = parseVirtualKey(secret);
      expect(parsed.environment).toBe("live");
      expect(parsed.ulid).toHaveLength(26);
      expect(parsed.displayPrefix).toHaveLength(
        VIRTUAL_KEY_DISPLAY_PREFIX_LENGTH,
      );
      expect(parsed.displayPrefix.startsWith("lw_vk_live_")).toBe(true);
    });

    describe("when the key is malformed", () => {
      it("rejects a secret without the lw_vk_ prefix", () => {
        expect(() => parseVirtualKey("sk-live-abcdef")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects an unknown environment", () => {
        expect(() =>
          parseVirtualKey("lw_vk_staging_01H000000000000000000000"),
        ).toThrow(VirtualKeyCryptoError);
      });

      it("rejects a ulid shorter than 26 chars", () => {
        expect(() => parseVirtualKey("lw_vk_live_ABC")).toThrow(
          VirtualKeyCryptoError,
        );
      });

      it("rejects a ulid with non-Crockford characters", () => {
        expect(() =>
          parseVirtualKey("lw_vk_live_!!!!!!!!!!!!!!!!!!!!!!!!!!"),
        ).toThrow(VirtualKeyCryptoError);
      });
    });
  });

  describe("hashVirtualKeySecret", () => {
    it("produces a 64-char hex sha256 hash", () => {
      const secret = mintVirtualKeySecret("live");
      const hash = hashVirtualKeySecret(secret);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic — same input always yields same hash", () => {
      const secret = mintVirtualKeySecret("live");
      expect(hashVirtualKeySecret(secret)).toBe(hashVirtualKeySecret(secret));
    });

    it("changes with the pepper", () => {
      const secret = mintVirtualKeySecret("live");
      const first = hashVirtualKeySecret(secret);
      process.env.LW_VIRTUAL_KEY_PEPPER = "totally-different-pepper-32-bytes!";
      const second = hashVirtualKeySecret(secret);
      expect(first).not.toBe(second);
    });

    describe("when the pepper is missing", () => {
      it("throws pepper_missing", () => {
        delete process.env.LW_VIRTUAL_KEY_PEPPER;
        expect(() => hashVirtualKeySecret("lw_vk_live_x")).toThrow(
          /LW_VIRTUAL_KEY_PEPPER/,
        );
      });
    });
  });

  describe("verifyVirtualKeySecret", () => {
    it("returns true for a matching secret / hash pair", () => {
      const secret = mintVirtualKeySecret("live");
      const hash = hashVirtualKeySecret(secret);
      expect(verifyVirtualKeySecret(secret, hash)).toBe(true);
    });

    it("returns false for a non-matching secret", () => {
      const hash = hashVirtualKeySecret(mintVirtualKeySecret("live"));
      expect(
        verifyVirtualKeySecret(mintVirtualKeySecret("live"), hash),
      ).toBe(false);
    });

    it("returns false for a mismatched hex length", () => {
      const secret = mintVirtualKeySecret("live");
      expect(verifyVirtualKeySecret(secret, "abcd")).toBe(false);
    });
  });
});
