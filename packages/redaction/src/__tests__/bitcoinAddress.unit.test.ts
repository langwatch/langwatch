import { describe, expect, it } from "vitest";

import { isBase58CheckAddress, isBech32Address, isBitcoinAddress } from "../bitcoinAddress.ts";

/**
 * The whole point is telling a real address from a same-shaped hex string,
 * so vectors are real mainnet addresses and negatives are single-character
 * mutations of them. Accepting a mutation would be no better than the old pattern.
 */
const P2PKH = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const SEGWIT_V0 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TAPROOT = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

/**
 * The hex identifier the shape-only pattern used to call an address.
 * Generated from `seededRandom(20260912)`: leads with "1"/"3", no "0" — so
 * it sits inside the base58 alphabet, the negative worth asserting.
 */
const HEX_ID_SHAPED_LIKE_AN_ADDRESS = "13f895f8877e4bc5edc85c397fbd3668";

/**
 * One payload at three version bytes, so checksums are built the same way
 * and only the version differs. Version six is what matters: it renders
 * with a leading "3" and a valid checksum, yet Bitcoin mints no such address.
 */
const PAYLOAD_AT_V0 = "1F6gFLr6VjazEQvMSV5prBd3agThutz9S8";
const PAYLOAD_AT_V5 = "3FnhAtLY3duNKacnZakRGoyyjCkRWLW4rY";
const PAYLOAD_AT_V6 = "3f8J9zdpkpNF91ksb15jkwFmMi1N9Kyia4";

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

  /**
   * A checksum says the payload is intact, not that bitcoin would mint it.
   * The version byte is the rest of the grammar: mainnet spends exactly two
   * of 256 values, and any other is not an address whatever its checksum does.
   */
  describe("when the version byte is not one bitcoin mints", () => {
    it.each([
      ["version zero, pay-to-public-key-hash", PAYLOAD_AT_V0],
      ["version five, pay-to-script-hash", PAYLOAD_AT_V5],
    ])("accepts the same payload at %s", (_case, address) => {
      expect(isBase58CheckAddress(address)).toBe(true);
    });

    it("rejects a checksum valid token at version six", () => {
      expect(isBase58CheckAddress(PAYLOAD_AT_V6)).toBe(false);
    });

    it("keeps that token out of the crypto verdict entirely", () => {
      expect(isBitcoinAddress(PAYLOAD_AT_V6)).toBe(false);
    });
  });

  describe("when the address has been altered", () => {
    it.each([
      ["a changed payload character", mutate(P2PKH, 5, "9")],
      ["a changed checksum character", mutate(P2PKH, 33, "b")],
      ["a character outside the alphabet", mutate(P2PKH, 5, "0")],
      ["a truncated address", P2PKH.slice(0, -1)],
      ["a hex string of the same length", HEX_ID_SHAPED_LIKE_AN_ADDRESS],
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
      expect(isBech32Address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh")).toBe(false);
    });

    it("rejects a version one address carrying a bech32 checksum", () => {
      expect(
        isBech32Address("bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4"),
      ).toBe(false);
    });
  });

  /**
   * A checksum is only as narrow as the grammar behind it: the witness
   * version reads from a 32-character alphabet, but BIP-141 defines only
   * sixteen. One payload at two versions isolates the rejection to the version.
   */
  describe("when the witness version is one bitcoin does not define", () => {
    const PAYLOAD_AT_V1 = "bc1pr23clxd5mzfsh79vn6pg0kaytjeq8w4u8x8jd8";
    const PAYLOAD_AT_V17 = "bc13r23clxd5mzfsh79vn6pg0kaytjeq8w4un2kxzn";

    it("accepts the same payload written at a version bitcoin does define", () => {
      expect(isBech32Address(PAYLOAD_AT_V1)).toBe(true);
    });

    it("rejects a checksum valid token at version seventeen", () => {
      expect(isBech32Address(PAYLOAD_AT_V17)).toBe(false);
    });
  });

  /**
   * The checksum covers the characters, not what they mean, so a string can
   * clear it and still encode no output anyone could pay to. Controls use
   * the same construction at an allowed length, isolating each rejection to the program rule.
   */
  describe("when the witness program is not one bitcoin allows", () => {
    it.each([
      ["a one-byte program, below the two-byte floor", "bc1pqvwl8xs0"],
      [
        "a forty-one byte program, above the ceiling",
        "bc1pqv9pzxqlyckngw6zf9g9whn9d3eh4qvg37tfmf9tk2uup37w6hww86h3lrlsvrg5rvlw2s2x",
      ],
      ["padding bits that are not zero", "bc1pqdnfnnda"],
      [
        "version zero at sixteen bytes, which is neither 20 nor 32",
        "BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P",
      ],
      ["version zero at sixteen bytes, constructed", "bc1qqv9pzxqlyckngw6zf9g9whn9dsaqaxas"],
    ])("rejects %s", (_case, address) => {
      expect(isBech32Address(address)).toBe(false);
    });

    it.each([
      ["version one at twenty bytes", "bc1pqv9pzxqlyckngw6zf9g9whn9d3eh4qvge0qxlk"],
      ["version zero at twenty bytes", "bc1qqv9pzxqlyckngw6zf9g9whn9d3eh4qvg8d8phl"],
    ])("accepts the same construction at %s", (_case, address) => {
      expect(isBech32Address(address)).toBe(true);
    });
  });

  describe("when the address has been altered", () => {
    it.each([
      ["a changed data character", mutate(SEGWIT_V0, 10, "p")],
      ["a character outside the charset", mutate(SEGWIT_V0, 10, "b")],
      ["a truncated address", SEGWIT_V0.slice(0, -1)],
      ["mixed case, which BIP-173 forbids", "bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"],
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
    expect(isBitcoinAddress(HEX_ID_SHAPED_LIKE_AN_ADDRESS)).toBe(false);
  });

  /**
   * BIP-173 allows uppercase (QR encoders emit it, packing into an
   * alphanumeric segment); the bech32 validator already reads it. Only the
   * routing prefix was lowercase, sending uppercase to base58 for a false rejection.
   */
  it("routes an uppercase segwit address to the bech32 validator", () => {
    expect(isBitcoinAddress(SEGWIT_V0.toUpperCase())).toBe(true);
    expect(isBitcoinAddress(TAPROOT.toUpperCase())).toBe(true);
  });

  /** Mixed case stays invalid: BIP-173 forbids it, in either router. */
  it("still rejects a mixed case segwit address", () => {
    expect(isBitcoinAddress("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7Kv8f3t4")).toBe(false);
  });
});
