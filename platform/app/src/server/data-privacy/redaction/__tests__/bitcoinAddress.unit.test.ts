import { describe, expect, it } from "vitest";

import {
  isBase58CheckAddress,
  isBech32Address,
  isBitcoinAddress,
} from "../bitcoinAddress";

/**
 * The whole point of these validators is that they can tell a real address from
 * a hex string of the same shape, so the vectors are real mainnet addresses and
 * the negatives are single-character mutations of them. A validator that
 * accepted its own mutations would be no better than the pattern it replaced.
 */
const P2PKH = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const SEGWIT_V0 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TAPROOT =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

/** Swaps one character so the checksum no longer covers the payload. */
function mutate(address: string, index: number, replacement: string): string {
  return address.slice(0, index) + replacement + address.slice(index + 1);
}

describe("given a base58check address", () => {
  describe("when the address is real", () => {
    it.each([
      ["a pay-to-public-key-hash address", P2PKH],
      ["a pay-to-script-hash address", P2SH],
    ])("accepts %s", (_case, address) => {
      expect(isBase58CheckAddress(address)).toBe(true);
    });

    /**
     * The leading "1" is a zero byte, not a digit, and a decoder that drops it
     * produces a 24-byte payload whose checksum still lines up by accident on
     * some inputs. Keeping a P2PKH vector pins that the leading zeros survive.
     */
    it("decodes the leading zero byte rather than dropping it", () => {
      expect(isBase58CheckAddress(P2PKH)).toBe(true);
      expect(isBase58CheckAddress(P2PKH.slice(1))).toBe(false);
    });
  });

  describe("when the address has been altered", () => {
    it.each([
      ["a changed payload character", mutate(P2PKH, 5, "9")],
      ["a changed checksum character", mutate(P2PKH, 33, "b")],
      ["a character outside the alphabet", mutate(P2PKH, 5, "0")],
      ["a truncated address", P2PKH.slice(0, -1)],
      ["a hex string of the same length", "13946a8d2428cdec9e2cd92f8419a225"],
    ])("rejects %s", (_case, address) => {
      expect(isBase58CheckAddress(address)).toBe(false);
    });
  });
});

describe("given a bech32 address", () => {
  describe("when the witness version matches the checksum constant", () => {
    it("accepts a version zero address with a bech32 checksum", () => {
      expect(isBech32Address(SEGWIT_V0)).toBe(true);
    });

    it("accepts a taproot address with a bech32m checksum", () => {
      expect(isBech32Address(TAPROOT)).toBe(true);
    });
  });

  /**
   * BIP-350 pairs version zero with bech32 and every later version with
   * bech32m. Accepting either constant for either version would make these two
   * BIP-350 invalid vectors validate.
   */
  describe("when the witness version and the checksum constant disagree", () => {
    it("rejects a version zero address carrying a bech32m checksum", () => {
      expect(
        isBech32Address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh"),
      ).toBe(false);
    });

    it("rejects a version one address carrying a bech32 checksum", () => {
      expect(
        isBech32Address(
          "bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4",
        ),
      ).toBe(false);
    });
  });

  describe("when the address has been altered", () => {
    it.each([
      ["a changed data character", mutate(SEGWIT_V0, 10, "p")],
      ["a character outside the charset", mutate(SEGWIT_V0, 10, "b")],
      ["a truncated address", SEGWIT_V0.slice(0, -1)],
      [
        "mixed case, which BIP-173 forbids",
        "bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      ],
      ["nothing but the prefix", "bc1"],
    ])("rejects %s", (_case, address) => {
      expect(isBech32Address(address)).toBe(false);
    });
  });
});

describe("given either address form", () => {
  it("routes by prefix and accepts every real vector", () => {
    for (const address of [P2PKH, P2SH, SEGWIT_V0, TAPROOT]) {
      expect(isBitcoinAddress(address)).toBe(true);
    }
  });

  it("rejects a hex identifier that starts like an address", () => {
    expect(isBitcoinAddress("13946a8d2428cdec9e2cd92f8419a225")).toBe(false);
  });
});
