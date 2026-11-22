import { describe, expect, it } from "vitest";

import {
  extractUnknownIdentifier,
  isClickHouseInvalidQueryError,
  isClickHouseResultTooLargeError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
} from "../clickhouse.query-error-translation.mapper.ts";

describe("isClickHouseResultTooLargeError", () => {
  it.each([
    [
      "TOO_MANY_ROWS_OR_BYTES by driver properties",
      { code: "396", type: "TOO_MANY_ROWS_OR_BYTES" },
      "boom",
    ],
    [
      "TOO_MANY_ROWS_OR_BYTES from raw HTTP text",
      {},
      "Code: 396. DB::Exception: Limit for result exceeded, max rows: 10.00 thousand, current rows: 20.00 thousand. (TOO_MANY_ROWS_OR_BYTES)",
    ],
  ])("recognises %s", (_case, props, message) => {
    expect(isClickHouseResultTooLargeError(Object.assign(new Error(message), props))).toBe(true);
  });

  it("does not recognise TOO_MANY_ROWS, which is the read ceiling's code", () => {
    const raw = Object.assign(new Error("boom"), { code: "158", type: "TOO_MANY_ROWS" });

    expect(isClickHouseResultTooLargeError(raw)).toBe(false);
  });

  it("is false for unrelated errors and non-Error values", () => {
    expect(isClickHouseResultTooLargeError(Object.assign(new Error("boom"), { code: "241" }))).toBe(
      false,
    );
    expect(isClickHouseResultTooLargeError("nope")).toBe(false);
  });

  it("is left to the LangWatchQL executor, not mapped by the shared translation", () => {
    const raw = Object.assign(new Error("boom"), { code: "396", type: "TOO_MANY_ROWS_OR_BYTES" });

    expect(translateClickHouseQueryError(raw, 1)).toBe(raw);
  });
});

describe("extractUnknownIdentifier", () => {
  describe("given the analyzer's sentence for a name used as a function argument", () => {
    // Verbatim from a real 25.8 server: a name passed to a function gets the
    // longer "expression or function" sentence.
    const raised = () =>
      Object.assign(
        new Error(
          "Unknown expression or function identifier `trace_idd` in scope SELECT arrayJoin(trace_idd) AS label, count() AS n FROM traces GROUP BY label ORDER BY n DESC. Maybe you meant: ['label']. ",
        ),
        { code: "47", type: "UNKNOWN_IDENTIFIER" },
      );

    it("recognises it", () => {
      expect(isClickHouseUnknownIdentifierError(raised())).toBe(true);
    });

    /** @scenario "A missing column passed to a function is named in the refusal" */
    it("names the column, and nothing else from the message", () => {
      expect(extractUnknownIdentifier(raised())).toBe("trace_idd");
    });
  });
});

describe("isClickHouseInvalidQueryError", () => {
  const refusals = [
    ["ILLEGAL_AGGREGATION", "184"],
    ["NOT_AN_AGGREGATE", "215"],
    ["SYNTAX_ERROR", "62"],
    ["ILLEGAL_TYPE_OF_ARGUMENT", "43"],
    ["TYPE_MISMATCH", "53"],
    ["NUMBER_OF_ARGUMENTS_DOESNT_MATCH", "42"],
    ["NO_COMMON_TYPE", "386"],
    ["AMBIGUOUS_COLUMN_NAME", "352"],
    ["NOT_FOUND_COLUMN_IN_BLOCK", "10"],
    ["BAD_ARGUMENTS", "36"],
    ["ILLEGAL_COLUMN", "44"],
    ["CANNOT_CONVERT_TYPE", "70"],
    ["CANNOT_PARSE_TEXT", "6"],
    ["CANNOT_PARSE_INPUT_ASSERTION_FAILED", "27"],
  ] as const;

  /** @scenario "A query the database rejects as written is refused as the caller's fault" */
  it.each(refusals)("recognises %s by driver properties", (name, code) => {
    expect(
      isClickHouseInvalidQueryError(Object.assign(new Error("boom"), { code, type: name })),
    ).toBe(true);
  });

  /** @scenario "A query the database rejects as written is refused as the caller's fault" */
  it.each(refusals)("recognises %s from raw HTTP text", (name, code) => {
    expect(
      isClickHouseInvalidQueryError(new Error(`Code: ${code}. DB::Exception: refused. (${name})`)),
    ).toBe(true);
  });

  /** @scenario "A query the database rejects as written is refused as the caller's fault" */
  it("does not read a code token out of the echoed query", () => {
    expect(
      isClickHouseInvalidQueryError(
        new Error("Code: 47. DB::Exception: SELECT 'ILLEGAL_AGGREGATION' (UNKNOWN_IDENTIFIER)"),
      ),
    ).toBe(false);
  });

  it("is false for a non-error", () => {
    expect(isClickHouseInvalidQueryError("Code: 184.")).toBe(false);
  });
});
