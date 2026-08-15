/**
 * Text <-> JSON round-tripping for the key/value inputs that edit values which
 * are also written over REST/tRPC/SDK as real JSON.
 *
 * The interesting cases are the two the type signatures do not describe: a
 * value that has no text at all, and a string that would parse back as another
 * type if it were shown bare.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { describe, expect, it } from "vitest";

import {
  displayOptionalValue,
  displayValue,
  serializeOptionalScalarValue,
  serializeScalarValue,
} from "../jsonValueText";

describe("displayValue()", () => {
  describe("given a value JSON.stringify has no text for", () => {
    it("answers with the empty string rather than with undefined", () => {
      // `JSON.stringify(undefined)` is the VALUE undefined, not "undefined".
      // Returned from a function typed `: string` it reaches an input's
      // `value` prop and flips the field to uncontrolled on the next render.
      expect(displayValue(undefined)).toBe("");
      expect(displayValue(() => null)).toBe("");
      expect(displayValue(Symbol("s"))).toBe("");
    });
  });

  describe("given a string that would parse back as another type", () => {
    it("quotes it, so the next edit cannot coerce it", () => {
      expect(displayValue("7")).toBe('"7"');
      expect(displayValue("true")).toBe('"true"');
    });
  });

  describe("given a string that only looks like another type", () => {
    it("shows it bare, because it never parsed as one", () => {
      // `007` is not JSON: a leading zero is a syntax error, so it was always
      // text and needs no quoting to stay text.
      expect(displayValue("007")).toBe("007");
    });
  });

  describe("given ordinary text", () => {
    it("shows it bare", () => {
      expect(displayValue("eu-central")).toBe("eu-central");
    });
  });
});

describe("serializeScalarValue()", () => {
  describe("given text that parses as a scalar", () => {
    it("reads it as that scalar", () => {
      expect(serializeScalarValue("12")).toBe(12);
      expect(serializeScalarValue("true")).toBe(true);
      expect(serializeScalarValue('"007"')).toBe("007");
    });
  });

  describe("given text that parses as something a scalar field cannot hold", () => {
    it("keeps it as the text that was typed", () => {
      expect(serializeScalarValue("{}")).toBe("{}");
      expect(serializeScalarValue("[1,2]")).toBe("[1,2]");
      expect(serializeScalarValue("null")).toBe("null");
    });
  });
});

describe("the optional pair", () => {
  describe("given an empty box", () => {
    it("means absent rather than the empty string", () => {
      expect(serializeOptionalScalarValue("")).toBeUndefined();
      expect(displayOptionalValue(undefined)).toBe("");
    });
  });

  describe("given a value that was typed", () => {
    it("round-trips back to the same text", () => {
      for (const text of ["eu-central", "007", "12", "true", '"7"']) {
        expect(displayOptionalValue(serializeOptionalScalarValue(text))).toBe(
          text,
        );
      }
    });
  });
});
