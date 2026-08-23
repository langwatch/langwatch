import { describe, expect, it } from "vitest";

import {
  clickHouseMissingIdentifiers,
  isClickHouseUnknownIdentifierError,
} from "~/server/app-layer/clients/clickhouse/translate-query-error";

/**
 * A synthesised ClickHouse refusal, in the two forms the driver delivers:
 * typed properties on its own error objects, and the `Code: <n>.` prefix on a
 * raw HTTP body. The wordings are the engine's own, verbatim from a 25.8
 * server (`Unknown expression identifier` for analysis failures) plus the
 * `Missing columns:` listing shape other paths raise.
 */
const driverError = (message: string): Error =>
  Object.assign(new Error(message), {
    code: "47",
    type: "UNKNOWN_IDENTIFIER",
  });

// Verbatim from the server, including the echoed statement after "in scope".
const SCOPED_REFUSAL =
  "Code: 47. DB::Exception: Unknown expression identifier `no_such_column_anywhere` in scope SELECT no_such_column_anywhere FROM system.one. (UNKNOWN_IDENTIFIER) (version 25.8.1.5101 (official build))";

describe("given a ClickHouse refusal for unknown identifiers", () => {
  describe("when the refusal arrives through one delivery form at a time", () => {
    // Three separate errors, each carrying exactly one of the three forms the
    // matcher reads — so a suite pass proves every form matches alone, not
    // merely that one of them did.
    it.each([
      [
        "the driver's numeric code property",
        Object.assign(new Error("x"), { code: "47" }),
      ],
      [
        "the driver's symbolic type property",
        Object.assign(new Error("x"), { type: "UNKNOWN_IDENTIFIER" }),
      ],
      [
        "the raw body's Code: prefix",
        new Error(
          "Code: 47. DB::Exception: Unknown expression identifier `c` in scope SELECT c.",
        ),
      ],
    ])("recognises %s", (_label, error) => {
      expect(isClickHouseUnknownIdentifierError(error)).toBe(true);
    });

    it("does not let a message token select the error class", () => {
      // The symbolic name never matches out of the message: a member could
      // alias a column UNKNOWN_IDENTIFIER and choose its own error otherwise.
      const spoofed = new Error(
        "SELECT UNKNOWN_IDENTIFIER AS x FROM MEMORY_LIMIT_EXCEEDED",
      );
      expect(isClickHouseUnknownIdentifierError(spoofed)).toBe(false);
    });
  });

  describe("when the interpreter path refuses instead of the analyzer", () => {
    it("recognises NO_SUCH_COLUMN_IN_TABLE as the same refusal", () => {
      const interpreter = Object.assign(new Error("x"), { code: "16" });
      expect(isClickHouseUnknownIdentifierError(interpreter)).toBe(true);
      expect(
        clickHouseMissingIdentifiers(
          Object.assign(
            new Error(
              "Code: 16. DB::Exception: There is no column with name missing_col in table t",
            ),
            { code: "16" },
          ),
        ),
      ).toEqual(["missing_col"]);
    });
  });

  describe("when the refused name is qualified with dots", () => {
    it("keeps the whole dotted name intact", () => {
      const dotted = driverError(
        "Code: 47. DB::Exception: Unknown expression identifier `analytics.traces.user_id` in scope SELECT analytics.traces.user_id.",
      );
      expect(clickHouseMissingIdentifiers(dotted)).toEqual([
        "analytics.traces.user_id",
      ]);
    });
  });

  describe("when the refusal arrives by code or type or body prefix", () => {
    it("is recognised across the combined fixture too", () => {
      expect(isClickHouseUnknownIdentifierError(driverError("x"))).toBe(true);
      expect(
        isClickHouseUnknownIdentifierError(new Error("some other failure")),
      ).toBe(false);
    });
  });

  describe("when the statement that produced it also contains quoted text", () => {
    const echoed = driverError(SCOPED_REFUSAL);

    // @scenario "Only the missing column names travel in the error meta"
    it("extracts exactly the backquoted name, and nothing from the echoed scope", () => {
      expect(clickHouseMissingIdentifiers(echoed)).toEqual([
        "no_such_column_anywhere",
      ]);
    });

    it("reads every name out of the listing wording too", () => {
      const listed = driverError(
        "Code: 47. DB::Exception: Missing columns: 'missing_b', 'missing_a' while processing query: SELECT \\'don\\'t leak this part\\'' FROM t",
      );
      expect(clickHouseMissingIdentifiers(listed)).toEqual([
        "missing_a",
        "missing_b",
      ]);
    });
  });

  describe("when the refusal carries no parseable clause", () => {
    it("answers no identifiers rather than guessing", () => {
      expect(
        clickHouseMissingIdentifiers(driverError("Code: 47. DB::Exception.")),
      ).toEqual([]);
      expect(clickHouseMissingIdentifiers(new Error("unrelated"))).toEqual([]);
    });
  });
});
