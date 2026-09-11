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

  describe("given a millisecond timestamp that happens to pass the Luhn check", () => {
    /** @scenario "A millisecond timestamp is not read as a card number" */
    it("keeps the timestamp in a JSON payload", () => {
      const text = '{"ttft.first_token_at_ms": 1757500123454}';

      expect(redactEssentialPiiInText({ text }).text).toBe(text);
    });

    it("keeps a nineteen-digit nanosecond timestamp", () => {
      const text = "started at 1757500123454000009 ns";

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

    it("redacts a Mastercard number in the two-series range", () => {
      expect(
        redactEssentialPiiInText({ text: "card 2223003122003222" }).text,
      ).toBe("card [CREDIT_CARD]");
    });

    it("redacts an American Express number", () => {
      expect(
        redactEssentialPiiInText({ text: "card 378282246310005" }).text,
      ).toBe("card [CREDIT_CARD]");
    });

    it("redacts a card written with spaces", () => {
      expect(
        redactEssentialPiiInText({ text: "card 4111 1111 1111 1111 ok" }).text,
      ).toBe("card [CREDIT_CARD] ok");
    });
  });
});
