/**
 * The only thing between a caller's words and a statement: an eval function's
 * options are literals, so they are written, not bound.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  clickHouseDateTime64,
  sqlInteger,
  sqlNumber,
  sqlString,
  sqlStringArray,
} from "../instant-eval-sql.rules.ts";

describe("given a value going into a statement", () => {
  describe("when it is written as a string literal", () => {
    it("quotes it and escapes what would end the literal early", () => {
      expect(sqlString("plain")).toBe("'plain'");
      expect(sqlString("it's")).toBe("'it\\'s'");
      expect(sqlString("a\\b")).toBe("'a\\\\b'");
      expect(sqlString("'; DROP TABLE traces --")).toBe("'\\'; DROP TABLE traces --'");
    });

    it("writes a list as a ClickHouse array of them", () => {
      expect(sqlStringArray(["a", "it's"])).toBe("['a', 'it\\'s']");
      expect(sqlStringArray([])).toBe("[]");
    });
  });

  describe("when it is written as a number", () => {
    it("writes a whole number plainly and refuses a fraction where one is wrong", () => {
      expect(sqlInteger(8_000)).toBe("8000");
      expect(() => sqlInteger(0.5)).toThrow(/whole number/);
    });

    it("gives a whole number a decimal point where the catalogue wants a fraction", () => {
      expect(sqlNumber(1)).toBe("1.0");
      expect(sqlNumber(0.7)).toBe("0.7");
    });
  });
});

describe("given an instant bound to a DateTime64(3) parameter", () => {
  describe("when it is written", () => {
    it("keeps the milliseconds, in the views' own precision", () => {
      expect(clickHouseDateTime64(Temporal.Instant.from("2026-09-18T10:00:00.123456Z"))).toBe(
        "2026-09-18 10:00:00.123",
      );
    });
  });
});
