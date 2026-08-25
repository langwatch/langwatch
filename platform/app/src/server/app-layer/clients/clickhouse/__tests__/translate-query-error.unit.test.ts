import { describe, expect, it } from "vitest";
import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "~/server/app-layer/traces/errors";
import {
  isClickHouseObjectUnavailableError,
  translateClickHouseQueryError,
} from "../translate-query-error";

describe("translateClickHouseQueryError", () => {
  describe("given a MEMORY_LIMIT_EXCEEDED driver error", () => {
    it("translates to QueryMemoryExceededError, preserving the raw error as a reason", () => {
      const raw = new Error(
        "Code: 241. DB::Exception: Memory limit (for query) exceeded: would use 3.5 GiB. (MEMORY_LIMIT_EXCEEDED)",
      );

      const translated = translateClickHouseQueryError(raw, 1234);

      expect(translated).toBeInstanceOf(QueryMemoryExceededError);
      const handled = translated as QueryMemoryExceededError;
      expect(handled.code).toBe("query_memory_exceeded");
      expect(handled.reasons).toEqual([raw]);
      expect(handled.serialize().tips).toContain("Narrow the time range");
    });

    it("matches on the driver `type` property without a message fragment", () => {
      const raw = Object.assign(new Error("boom"), {
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
      });

      expect(translateClickHouseQueryError(raw, 1)).toBeInstanceOf(
        QueryMemoryExceededError,
      );
    });
  });

  describe("given a TIMEOUT_EXCEEDED driver error", () => {
    it("translates to QueryTimeoutError with the measured duration", () => {
      const raw = Object.assign(new Error("boom"), {
        code: "159",
        type: "TIMEOUT_EXCEEDED",
      });

      const translated = translateClickHouseQueryError(raw, 12_345);

      expect(translated).toBeInstanceOf(QueryTimeoutError);
      const handled = translated as QueryTimeoutError;
      expect(handled.message).toBe("Query timed out (12.3s)");
      expect(handled.reasons).toEqual([raw]);
    });
  });

  describe("given a scan-ceiling driver error", () => {
    /**
     * The message text is verbatim from `clickhouse-server:25.10.2.65` —
     * `max_rows_to_read` raises 158 and `max_bytes_to_read` raises 307, which
     * is the pairing the governed settings profile depends on.
     */
    it.each([
      [
        "158",
        "TOO_MANY_ROWS",
        "Code: 158. DB::Exception: Limit for rows (controlled by 'max_rows_to_read' setting) exceeded, max rows: 10.00, current rows: 1.00 million. (TOO_MANY_ROWS)",
      ],
      [
        "307",
        "TOO_MANY_BYTES",
        "Code: 307. DB::Exception: Limit for rows or bytes to read exceeded, max bytes: 10.00 B, current bytes: 511.01 KiB. (TOO_MANY_BYTES)",
      ],
    ])("translates %s / %s to QueryScanLimitExceededError", (code, type, message) => {
      const raw = Object.assign(new Error(message), { code, type });

      const translated = translateClickHouseQueryError(raw, 1234);

      expect(translated).toBeInstanceOf(QueryScanLimitExceededError);
      const handled = translated as QueryScanLimitExceededError;
      expect(handled.code).toBe("query_scan_limit_exceeded");
      expect(handled.httpStatus).toBe(422);
      expect(handled.reasons).toEqual([raw]);
      expect(handled.tips.length).toBeGreaterThan(0);
    });

    it("matches on the message alone, for an error that arrives as raw HTTP text", () => {
      const raw = new Error(
        "Code: 158. DB::Exception: Limit for rows exceeded. (TOO_MANY_ROWS)",
      );

      expect(translateClickHouseQueryError(raw, 1)).toBeInstanceOf(
        QueryScanLimitExceededError,
      );
    });

    // The two ceilings are separate failures with separate remedies; collapsing
    // the scan ceiling onto the memory code would tell the caller to select
    // fewer fields for a query that read too many rows.
    it("does not translate a memory limit to the scan code", () => {
      const raw = Object.assign(new Error("boom"), {
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
      });

      expect(translateClickHouseQueryError(raw, 1)).toBeInstanceOf(
        QueryMemoryExceededError,
      );
    });
  });

  describe("given a connection-level failure", () => {
    it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"])(
      "translates %s to ClickHouseUnavailableError",
      (errno) => {
        const raw = Object.assign(new Error(`connect ${errno}`), {
          code: errno,
        });

        const translated = translateClickHouseQueryError(raw, 50);

        expect(translated).toBeInstanceOf(ClickHouseUnavailableError);
        expect((translated as ClickHouseUnavailableError).fault).toBe("platform");
      },
    );

    it("translates a 503 response to ClickHouseUnavailableError", () => {
      const raw = Object.assign(new Error("service unavailable"), {
        statusCode: 503,
      });

      expect(translateClickHouseQueryError(raw, 50)).toBeInstanceOf(
        ClickHouseUnavailableError,
      );
    });
  });

  describe("given an unrecognised error", () => {
    it("passes it through untouched so it degrades to unknown at the boundary", () => {
      const raw = new Error("Code: 62. DB::Exception: Syntax error");

      expect(translateClickHouseQueryError(raw, 10)).toBe(raw);
    });

    it("passes non-Error values through untouched", () => {
      expect(translateClickHouseQueryError("nope", 10)).toBe("nope");
    });
  });

  describe("given an already-handled error", () => {
    it("does not double-translate", () => {
      const handled = new QueryMemoryExceededError();

      // Not reachable via the driver today, but guards against wrapper
      // stacking: handled errors pass through as themselves.
      const translated = translateClickHouseQueryError(handled, 10);
      expect(translated).toBe(handled);
    });
  });

  describe("given a message that echoes a query naming a variant", () => {
    /**
     * The engine echoes the submitted query back in the message, so anything
     * read from the body has to come from the part the engine wrote itself.
     * Searching the whole message for the symbolic name let a caller pick the
     * error code by naming a table after it.
     */
    it.each([
      [
        "a table named after the memory variant",
        "Code: 60. DB::Exception: Table analytics.MEMORY_LIMIT_EXCEEDED doesn't exist",
      ],
      [
        "an alias named after the scan variant",
        "Code: 60. DB::Exception: Unknown table expression TOO_MANY_ROWS",
      ],
    ])("does not classify by the echoed name: %s", (_case, text) => {
      const raw = new Error(text);

      // Untouched — code 60 is not one of the mapped variants, and the name in
      // the echoed query does not get a vote.
      expect(translateClickHouseQueryError(raw, 10)).toBe(raw);
    });

    it("still reads the engine's own code prefix when the driver sets no properties", () => {
      // Raw HTTP text: no `code`/`type` properties, so the leading prefix the
      // engine writes is the only thing left to read.
      const raw = new Error("Code: 158. DB::Exception: Limit for rows to read exceeded");

      expect(translateClickHouseQueryError(raw, 10)).toBeInstanceOf(
        QueryScanLimitExceededError,
      );
    });
  });
});

describe("isClickHouseObjectUnavailableError", () => {
  it.each([
    ["UNKNOWN_TABLE by driver properties", { code: "60", type: "UNKNOWN_TABLE" }, "boom"],
    [
      "UNKNOWN_DATABASE by driver properties",
      { code: "81", type: "UNKNOWN_DATABASE" },
      "boom",
    ],
    [
      "ACCESS_DENIED by driver properties",
      { code: "497", type: "ACCESS_DENIED" },
      "boom",
    ],
    [
      "UNKNOWN_TABLE from raw HTTP text",
      {},
      "Code: 60. DB::Exception: Table lwql.traces does not exist. (UNKNOWN_TABLE)",
    ],
    [
      "ACCESS_DENIED from raw HTTP text",
      {},
      "Code: 497. DB::Exception: lwql_reader: Not enough privileges. (ACCESS_DENIED)",
    ],
  ])("recognises %s", (_case, props, message) => {
    const raw = Object.assign(new Error(message), props);

    expect(isClickHouseObjectUnavailableError(raw)).toBe(true);
  });

  it("does not classify by a variant name echoed from the query", () => {
    // The engine echoes the submitted query in the message; only the anchored
    // `Code: <n>.` prefix the engine writes itself gets a vote.
    const raw = new Error("Code: 62. DB::Exception: Syntax error near UNKNOWN_TABLE");

    expect(isClickHouseObjectUnavailableError(raw)).toBe(false);
  });

  it("is false for unrelated errors and non-Error values", () => {
    expect(
      isClickHouseObjectUnavailableError(
        Object.assign(new Error("boom"), { code: "241" }),
      ),
    ).toBe(false);
    expect(isClickHouseObjectUnavailableError("nope")).toBe(false);
  });
});
