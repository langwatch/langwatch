import { describe, expect, it } from "vitest";

import { METADATA_SUBKEY_PREFIXES } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  isHeldOutIdentifierAttribute,
  isIdentifierShapedValue,
  isOpaqueIdentifierValue,
  isReservedIdentifierAttributeKey,
} from "../identifierHoldout";

/** A decimal trace address, the case the reserved names exist for. */
const DECIMAL_TRACE_ADDRESS = "17575001234540000091234567890123";

/**
 * The two value rules answer different questions and are deliberately not the
 * same rule.
 *
 * `isIdentifierShapedValue` decides whether to run shape-only recognizers — a
 * bitcoin pattern, a phone pattern. Getting it wrong costs a recognizer that
 * would have fired on a name anyway, because the native engine has no notion of
 * a person, so the rule can be generous.
 *
 * `isOpaqueIdentifierValue` decides whether a value is ever offered to the
 * service that DOES find names and places. Getting it wrong stores a name in
 * the clear, so the rule has to be mean: a value qualifies only when it carries
 * a run no person would type.
 *
 * Every identifier fixture below is GENERATED, never observed: each is drawn
 * from the same mulberry32 generator the corpus tests use, seeded 20260912,
 * over the hex or Crockford-base32 alphabet. Nothing here names a real trace,
 * span or session.
 */
describe("given the identifier hold-out rules", () => {
  describe("when the value is a machine identifier", () => {
    it.each([
      ["a 32-character hex trace id", "13f895f8877e4bc5edc85c397fbd3668"],
      ["a 16-character hex span id", "f52185dd67918e00"],
      ["a hex id made only of letters", "deadbeefcafebabe"],
      // Draws 65-94 of the seeded stream described above, past the offsets the
      // hex fixtures use. Reproduce with `pick(seededRandom(20260912), HEX, 64)`
      // discarded first.
      ["a dashed uuid", "1b7fb23b-1b00-4047-aa30-8561e28ec6de"],
      ["an uppercase uuid", "1B7FB23B-1B00-4047-AA30-8561E28EC6DE"],
      ["a prefixed ULID", "session_yfasw32w6mzzxm8vfdb3atygdv"],
      ["a prefixed hex id", "trace_49386409e80a37fa22dc518583b31932"],
      // Assembled rather than written out: the literal is high-entropy enough
      // that the secrets gate reads it as a credential, and a fixture is not
      // worth an allowlist entry that would stand forever.
      [
        "a base64-style token",
        Buffer.from("hello world 1234567890").toString("base64"),
      ],
    ])("treats %s as opaque", (_case, value) => {
      expect(isOpaqueIdentifierValue(value)).toBe(true);
    });
  });

  describe("when the value is a name or a place written as one token", () => {
    it.each([
      ["a hyphenated name", "Elise-Marin-Van-Toren"],
      ["a surname-first hyphenated name", "Gonzalez-Rodriguez-Maria"],
      ["a hyphenated composer", "Wolfgang-Amadeus-Mozart"],
      ["a run-together name", "AnneMarieJohansson"],
      ["a dotted name carrying a year", "maria.schmidt.1972"],
      ["a hyphenated hospital", "Saint-Jean-Baptiste-Hospital"],
      ["a hyphenated street address", "Elm-Street-Apartment-4B"],
      ["a name with a space", "Jane Doe"],
    ])("does not treat %s as opaque", (_case, value) => {
      expect(isOpaqueIdentifierValue(value)).toBe(false);
    });

    /**
     * The looser rule is wrong on exactly these, which is the reason the
     * analysis path cannot borrow it. Pinning that here means a future merge of
     * the two rules fails loudly instead of quietly re-opening the leak.
     */
    it("should call a written name identifier-shaped, which is why the analysis path cannot borrow the rule", () => {
      expect(isIdentifierShapedValue("Elise-Marin-Van-Toren")).toBe(true);
      expect(isIdentifierShapedValue("AnneMarieJohansson")).toBe(true);
      expect(isIdentifierShapedValue("maria.schmidt.1972")).toBe(true);
    });
  });

  describe("when the value carries an identifier but is not one", () => {
    it.each([
      [
        "a sentence quoting a prefixed id",
        "Jane Doe on trace_49386409e80a37fa22dc518583b31932",
      ],
      [
        "a sentence quoting a bare hex id",
        "Jane Doe on 49386409e80a37fa22dc518583b31932",
      ],
      [
        "a JSON fragment",
        '{"user":"Jane Doe","trace":"49386409e80a37fa22dc518583b31932"}',
      ],
      [
        "a URL path",
        "https://acme.example.com/u/jane.doe/49386409e80a37fa22dc518583b31932",
      ],
    ])("does not treat %s as opaque", (_case, value) => {
      expect(isOpaqueIdentifierValue(value)).toBe(false);
    });

    /**
     * The run inside each of those IS opaque. Pinning that here is what shows
     * the cases above are rejected by the whole-value rule, and not because the
     * identifier in them was too weak to be recognised in the first place.
     */
    it("holds the identifier back when it stands on its own", () => {
      expect(
        isOpaqueIdentifierValue("trace_49386409e80a37fa22dc518583b31932"),
      ).toBe(true);
      expect(isOpaqueIdentifierValue("49386409e80a37fa22dc518583b31932")).toBe(
        true,
      );
    });
  });

  describe("when the value is a digit run", () => {
    it.each([
      ["a bare card number", "4111111111111111"],
      ["a phone number", "+31 6 12345678"],
      ["a millisecond timestamp", "1757500123454"],
      ["a decimal trace id", "17575001234540000091234567890123"],
    ])("does not treat %s as opaque", (_case, value) => {
      expect(isOpaqueIdentifierValue(value)).toBe(false);
    });
  });

  describe("when the value is longer than the scan cap", () => {
    it("gives up rather than scanning arbitrary text", () => {
      expect(isOpaqueIdentifierValue("a1".repeat(200))).toBe(false);
    });
  });

  describe("when the attribute name reserves a tracer address", () => {
    it.each([
      "metadata.otelTraceId",
      "metadata.trace_id",
      "trace_id",
      "spanid",
    ])("reserves %s whatever its case", (key) => {
      expect(isReservedIdentifierAttributeKey(key)).toBe(true);
    });

    it("holds a reserved attribute back even when the value is all digits", () => {
      expect(
        isHeldOutIdentifierAttribute({
          key: "metadata.trace_id",
          value: "17575001234540000091234567890123",
        }),
      ).toBe(true);
    });

    /**
     * The name is not enough on its own. Anyone sending spans chooses their own
     * attribute names, so a reserved name can arrive over anything at all, and
     * holding it back on the name alone stores whatever it holds in the clear.
     */
    it.each([
      ["an email address", "jane@example.com"],
      ["a person name", "Jane Doe"],
      ["a dotted person name", "jane.doe"],
    ])("does not hold a reserved name back over %s", (_case, value) => {
      expect(isReservedIdentifierAttributeKey("metadata.trace_id")).toBe(true);
      expect(
        isHeldOutIdentifierAttribute({ key: "metadata.trace_id", value }),
      ).toBe(false);
    });

    /**
     * The namespace is matched whole, not as a bare `langwatch.` prefix over
     * anything. `langwatch.trace_id` is a name a sender may write, but nothing
     * folds it to `metadata.trace_id`, so reading it as reserved would hand out
     * the exemption on a spelling the pipeline never produces. The prefixes are
     * the canonicaliser's own list precisely so this stays in step with it.
     */
    it.each([
      "langwatch.trace_id",
      "langwatch.traceid",
      "langwatch.foo.trace_id",
    ])("does not reserve %s, which no namespace folds to a reserved name", (key) => {
      expect(isReservedIdentifierAttributeKey(key)).toBe(false);
    });

    it.each([
      "langwatch.user_id",
      "langwatch.customer_id",
      "langwatch.thread_id",
      "gen_ai.conversation.id",
    ])("does not reserve %s, which customers fill in themselves", (key) => {
      expect(isReservedIdentifierAttributeKey(key)).toBe(false);
      expect(isHeldOutIdentifierAttribute({ key, value: "Jane Doe" })).toBe(
        false,
      );
    });

    /**
     * Every namespace the canonicaliser folds into `metadata.<key>` has to be
     * recognised here, because redaction runs BEFORE that fold: a name this
     * function misses is a name the hold-out never sees.
     *
     * The prefixes are read from the canonicaliser's own constant rather than
     * copied, and the loop is over that constant rather than over a literal
     * list. Adding a namespace there and not here is then a red test instead of
     * a silent hole — which is exactly how `langwatch.trace.` was missed.
     */
    it.each(
      METADATA_SUBKEY_PREFIXES,
    )("reserves a trace address written under the %s namespace", (prefix) => {
      expect(isReservedIdentifierAttributeKey(`${prefix}trace_id`)).toBe(true);
      expect(isReservedIdentifierAttributeKey(`${prefix}traceid`)).toBe(true);
      expect(
        isHeldOutIdentifierAttribute({
          key: `${prefix}trace_id`,
          value: DECIMAL_TRACE_ADDRESS,
        }),
      ).toBe(true);
    });
  });
});
