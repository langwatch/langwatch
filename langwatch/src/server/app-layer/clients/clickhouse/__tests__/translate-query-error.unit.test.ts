import { describe, expect, it } from "vitest";
import { HandledError } from "~/server/app-layer/handled-error";
import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryTimeoutError,
} from "~/server/app-layer/traces/errors";
import { translateClickHouseQueryError } from "../translate-query-error";

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

  describe("given a connection-level failure", () => {
    it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"])(
      "translates %s to ClickHouseUnavailableError",
      (errno) => {
        const raw = Object.assign(new Error(`connect ${errno}`), {
          code: errno,
        });

        const translated = translateClickHouseQueryError(raw, 50);

        expect(translated).toBeInstanceOf(ClickHouseUnavailableError);
        expect((translated as ClickHouseUnavailableError).fault).toBe(
          "platform",
        );
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
      expect(translated).toBeInstanceOf(HandledError);
    });
  });
});
