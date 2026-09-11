import { describe, expect, it } from "vitest";

import {
  isHeldOutIdentifierAttribute,
  isIdentifierShapedValue,
  isOpaqueIdentifierValue,
  isReservedIdentifierAttributeKey,
} from "../identifierHoldout";

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
 */
describe("given the identifier hold-out rules", () => {
  describe("when the value is a machine identifier", () => {
    it.each([
      ["a 32-character hex trace id", "13946a8d2428cdec9e2cd92f8419a225"],
      ["a 16-character hex span id", "c87fa28b188bd8ef"],
      ["a hex id made only of letters", "deadbeefcafebabe"],
      ["a dashed uuid", "c10ce98b-6ec2-48fc-a738-5da0c24883a3"],
      ["an uppercase uuid", "C10CE98B-6EC2-48FC-A738-5DA0C24883A3"],
      ["a prefixed ULID", "session_01m28j7xr2eh2tshbzctd385hx"],
      ["a prefixed hex id", "trace_db237ee0db82f81cc87fa28b188bd8ef"],
      ["a base64-style token", "aGVsbG8gd29ybGQgMTIzNDU2Nzg5MA=="],
    ])("treats %s as opaque", (_case, value) => {
      expect(isOpaqueIdentifierValue(value)).toBe(true);
    });
  });

  describe("when the value is a name or a place written as one token", () => {
    it.each([
      ["a hyphenated name", "Jean-Claude-Van-Damme"],
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
    it("is a case the shape rule alone would get wrong", () => {
      expect(isIdentifierShapedValue("Jean-Claude-Van-Damme")).toBe(true);
      expect(isIdentifierShapedValue("AnneMarieJohansson")).toBe(true);
      expect(isIdentifierShapedValue("maria.schmidt.1972")).toBe(true);
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
  });
});
