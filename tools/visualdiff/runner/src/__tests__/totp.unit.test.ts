import { describe, expect, it } from "vitest";

import { secretIn, totpCode } from "../flows/totp.ts";

/** RFC 6238 appendix B: the SHA1 secret "12345678901234567890", its 8-digit codes cut to 6. */
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("Feature: Visual diff flow actions", () => {
  describe("given a shared secret", () => {
    describe("when the current code is computed", () => {
      it("matches the RFC 6238 vectors", () => {
        expect(totpCode({ secret: SECRET, at: 59_000 })).toBe("287082");
        expect(totpCode({ secret: SECRET, at: 1_111_111_109_000 })).toBe("081804");
        expect(totpCode({ secret: SECRET, at: 1_234_567_890_000 })).toBe("005924");
      });

      it("reads a spaced, lower-case secret as the same key", () => {
        const spaced = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
        expect(totpCode({ secret: spaced, at: 59_000 })).toBe("287082");
      });

      it("takes the secret out of an otpauth link", () => {
        expect(secretIn(`otpauth://totp/x?secret=${SECRET}&issuer=y`)).toBe(SECRET);
      });
    });
  });
});
