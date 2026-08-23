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
  describe("when the refusal arrives by code or type or body prefix", () => {
    it("is recognised in all three delivery forms", () => {
      expect(isClickHouseUnknownIdentifierError(driverError("x"))).toBe(true);
      expect(
        isClickHouseUnknownIdentifierError(
          Object.assign(
            new Error(
              "Code: 47. DB::Exception: Unknown expression identifier `c` in scope SELECT c.",
            ),
            { type: "UNKNOWN_IDENTIFIER" },
          ),
        ),
      ).toBe(true);
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
