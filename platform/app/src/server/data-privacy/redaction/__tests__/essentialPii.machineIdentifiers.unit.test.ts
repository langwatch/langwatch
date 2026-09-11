import { describe, expect, it } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii";

/**
 * A seeded generator, so a corpus that fails names the same value on a re-run
 * and a fix can be checked against the exact id that broke.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexCorpus({
  count,
  length,
  seed,
}: {
  count: number;
  length: number;
  seed: number;
}): string[] {
  const next = seededRandom(seed);
  const digits = "0123456789abcdef";
  return Array.from({ length: count }, () =>
    Array.from({ length }, () => digits[Math.floor(next() * 16)]!).join(""),
  );
}

const asAttributeValue = (text: string) =>
  redactEssentialPiiInText({ text, isAttributeValue: true }).text;

/**
 * The genesis block address and the BIP-173 reference addresses: public
 * constants with valid checksums, none belonging to anyone reachable.
 */
const REAL_P2PKH_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const REAL_P2SH_ADDRESS = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const REAL_BECH32_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
/** BIP-350 reference: witness version 1, so a bech32m checksum, not bech32. */
const REAL_TAPROOT_ADDRESS =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

/** A 32-hex OTel trace id that the shape-only bitcoin pattern matches. */
const HEX_TRACE_ID_SHAPED_LIKE_AN_ADDRESS = "13946a8d2428cdec9e2cd92f8419a225";

describe("the native essential-PII engine on machine identifiers", () => {
  describe("given an attribute value that is one opaque trace identifier", () => {
    /** @scenario "An opaque trace identifier survives redaction at the default level" */
    it("keeps a hex trace id that the bitcoin pattern matches on shape", () => {
      expect(asAttributeValue(HEX_TRACE_ID_SHAPED_LIKE_AN_ADDRESS)).toBe(
        HEX_TRACE_ID_SHAPED_LIKE_AN_ADDRESS,
      );
    });

    /** @scenario "A corpus of random hex identifiers survives the native engine intact" */
    it("keeps every one of two thousand random 32-character hex ids", () => {
      const corpus = hexCorpus({ count: 2000, length: 32, seed: 20260911 });
      // Guard the guard: a corpus that never reaches the pattern would pass
      // vacuously, so require the shape the defect fired on to be present.
      expect(corpus.filter((id) => /^[13]/.test(id)).length).toBeGreaterThan(
        100,
      );

      const destroyed = corpus.filter((id) => asAttributeValue(id) !== id);

      expect(destroyed).toEqual([]);
    });

    /** @scenario "A corpus of random hex identifiers survives the native engine intact" */
    it("keeps every one of two thousand random 16-character hex span ids", () => {
      const corpus = hexCorpus({ count: 2000, length: 16, seed: 771 });

      expect(corpus.filter((id) => asAttributeValue(id) !== id)).toEqual([]);
    });
  });

  describe("given a real bitcoin address", () => {
    /** @scenario "A real bitcoin address is still redacted" */
    it("redacts a pay-to-public-key-hash address", () => {
      expect(asAttributeValue(REAL_P2PKH_ADDRESS)).toBe("[CRYPTO]");
    });

    /** @scenario "A real bitcoin address is still redacted" */
    it("redacts a pay-to-script-hash address", () => {
      expect(asAttributeValue(REAL_P2SH_ADDRESS)).toBe("[CRYPTO]");
    });

    /** @scenario "A real bitcoin address is still redacted" */
    it("redacts a bech32 address", () => {
      expect(asAttributeValue(REAL_BECH32_ADDRESS)).toBe("[CRYPTO]");
    });

    /** @scenario "A taproot address is still redacted" */
    it("redacts a taproot address, which uses the other checksum constant", () => {
      expect(asAttributeValue(REAL_TAPROOT_ADDRESS)).toBe("[CRYPTO]");
    });

    // Checksum valid, and still not an address: the character after the prefix
    // is a witness version of seventeen, and bitcoin defines sixteen.
    // Constructed for this test, because no such value exists in the wild to
    // borrow — which is the point, as a value of this shape in a customer
    // attribute is something else entirely and has to survive.
    /** @scenario "A token using a witness version bitcoin does not define is not an address" */
    it("keeps a checksum valid token whose witness version bitcoin does not define", () => {
      const token = "bc13r23clxd5mzfsh79vn6pg0kaytjeq8w4un2kxzn";

      expect(asAttributeValue(token)).toBe(token);
    });

    it("redacts an address written inside a sentence", () => {
      expect(
        redactEssentialPiiInText({ text: `send to ${REAL_P2PKH_ADDRESS} now` })
          .text,
      ).toBe("send to [CRYPTO] now");
    });

    it("keeps an address whose checksum has been altered", () => {
      const broken = `${REAL_P2PKH_ADDRESS.slice(0, -1)}b`;

      expect(asAttributeValue(broken)).toBe(broken);
    });
  });

  describe("given a timestamp that happens to pass the Luhn check", () => {
    /** @scenario "A millisecond timestamp is not read as a card number" */
    it("keeps the timestamp in a JSON payload", () => {
      const text = '{"ttft.first_token_at_ms": 1757500123454}';

      expect(redactEssentialPiiInText({ text }).text).toBe(text);
    });

    // Each of these is Luhn-valid at its own width, which is what makes the
    // case real: the Luhn check alone would replace all three.
    /** @scenario "A timestamp is not read as a card number at any of its widths" */
    it("keeps millisecond, microsecond and nanosecond timestamps alike", () => {
      const timestamps = [
        "1757500123454",
        "1757500123450001",
        "1757500123450000004",
      ];
      const text = `ms ${timestamps[0]} us ${timestamps[1]} ns ${timestamps[2]}`;

      expect(redactEssentialPiiInText({ text }).text).toBe(text);
    });
  });

  describe("given a payment card number", () => {
    /** @scenario "A card number written without separators is still redacted" */
    it("redacts a Visa number written as one digit run", () => {
      expect(
        redactEssentialPiiInText({ text: "card 4111111111111111" }).text,
      ).toBe("card [CREDIT_CARD]");
    });

    it("redacts a card written with spaces", () => {
      expect(
        redactEssentialPiiInText({ text: "card 4111 1111 1111 1111 ok" }).text,
      ).toBe("card [CREDIT_CARD] ok");
    });

    // One Luhn-valid number per scheme, at a length that scheme issues. The
    // four at the end are the ones a leading-digit range check drops on the
    // floor, which is why they are named rather than left to a generic case.
    /** @scenario "Every card scheme in circulation is still redacted" */
    it.each([
      ["Visa, 16 digits", "4111111111111111"],
      ["Visa, 13 digits", "4222222222222"],
      ["Mastercard, 5-series", "5555555555554444"],
      ["Mastercard, 2-series", "2223003122003222"],
      ["American Express", "378282246310005"],
      ["Diners Club", "36227206271667"],
      ["Discover", "6011111111111117"],
      ["JCB", "3530111333300000"],
      ["UnionPay, 62-series", "6250947000000014"],
      ["Maestro", "6759649826438453"],
      ["UATP, leading one", "174185296307415"],
      ["UnionPay, 81-series", "8141852963074189"],
      ["Voyager", "869985296307418"],
      ["fleet card, 7-series", "7741852963074185"],
    ])("redacts %s", (_scheme, number) => {
      expect(redactEssentialPiiInText({ text: `card ${number} ok` }).text).toBe(
        "card [CREDIT_CARD] ok",
      );
    });

    it("keeps a number just outside the Mastercard two-series range", () => {
      const text = "ref 2721852963074180 ok";

      expect(redactEssentialPiiInText({ text }).text).toBe(text);
    });

    // From about June 2040 a millisecond timestamp starts `22`, and the wider
    // units follow, so the 2221-2720 window alone would let this defect back in
    // by the calendar. Mastercard issues sixteen digits there and nothing else,
    // so the thirteen- and nineteen-digit widths are closed on length.
    /** @scenario "A timestamp from the 2040s is not read as a card number" */
    it.each([
      ["thirteen digits", "2221000123455"],
      ["nineteen digits", "2221000123456789015"],
    ])("keeps a Luhn-valid number in the Mastercard window at %s", (_width, number) => {
      const text = `at ${number} ok`;

      expect(redactEssentialPiiInText({ text }).text).toBe(text);
    });

    it("still redacts a Mastercard two-series number at its own length", () => {
      expect(
        redactEssentialPiiInText({ text: "card 2221000123456781 ok" }).text,
      ).toBe("card [CREDIT_CARD] ok");
    });
  });
});
