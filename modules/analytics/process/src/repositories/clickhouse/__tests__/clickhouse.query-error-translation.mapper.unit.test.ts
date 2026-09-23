import { describe, expect, it } from "vitest";

import {
  isClickHouseResultTooLargeError,
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
