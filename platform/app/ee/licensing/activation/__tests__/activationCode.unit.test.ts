/**
 * What an activation code is: how it reads back, and why the value the
 * registry stores is not one.
 *
 * @see ../activationCode.ts
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */

import { describe, expect, it } from "vitest";

import {
  activationCodeHash,
  activationCodeHint,
  isActivationCodeShape,
  mintActivationCode,
  normaliseActivationCode,
} from "../activationCode";

describe("given a code as somebody typed it", () => {
  describe("when it is read back", () => {
    /** @scenario "A code is read back however it was typed" */
    it("is the same code whatever the case, spaces and dashes were", () => {
      const canonical = normaliseActivationCode("LW-A1B2-C3D4-E5F6-G7H8");

      expect(canonical).toBe("LWA1B2C3D4E5F6G7H8");
      expect(normaliseActivationCode("lw-a1b2-c3d4-e5f6-g7h8")).toBe(canonical);
      expect(normaliseActivationCode("  LWA1B2 C3D4 E5F6 G7H8 ")).toBe(
        canonical,
      );
    });

    it("refuses anything that is not a code", () => {
      expect(normaliseActivationCode("")).toBeNull();
      expect(normaliseActivationCode("LW-A1B2")).toBeNull();
      // I, L, O and U are not in the alphabet, so a code cannot contain them
      // and a misread 1 or 0 is refused rather than looked up.
      expect(normaliseActivationCode("LW-AIB2-C3D4-E5F6-G7H8")).toBeNull();
      expect(isActivationCodeShape("lwl_deadbeef")).toBe(false);
    });
  });
});

describe("given a code and the hash the registry stores for it", () => {
  describe("when somebody presents that hash as a code", () => {
    /** @scenario "The stored hash is not itself a usable code" */
    it("is not even the shape of a code, so it never reaches a lookup", () => {
      const code = normaliseActivationCode(mintActivationCode());
      if (!code) throw new Error("a minted code failed its own shape check");

      const stored = activationCodeHash(code);

      expect(stored).not.toBe(code);
      expect(normaliseActivationCode(stored)).toBeNull();
      // And were it somehow accepted, hashing it again lands somewhere else.
      expect(activationCodeHash(stored)).not.toBe(stored);
    });
  });
});

describe("given a freshly minted code", () => {
  describe("when it is read", () => {
    /** @scenario "A minted code uses no character a person would misread" */
    it("carries none of the four characters people misread", () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const code = mintActivationCode();
        expect(code).toMatch(/^LW(-[0-9A-Z]{4}){4}$/);
        expect(code.slice(2)).not.toMatch(/[ILOU]/);
        expect(normaliseActivationCode(code)).not.toBeNull();
      }
    });

    it("has a hint that names its last four characters and nothing else", () => {
      const code = normaliseActivationCode(mintActivationCode());
      if (!code) throw new Error("a minted code failed its own shape check");
      const hint = activationCodeHint(code);
      expect(hint).toHaveLength(4);
      expect(code.endsWith(hint)).toBe(true);
    });
  });
});
