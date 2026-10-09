/**
 * `clickHouseErrorCode` and `clickHouseErrorSummary` are what let provisioning
 * log a failure safely: the raw error (and its message) can carry the
 * restricted user's password or the PostgreSQL reader password in escaped
 * form, so only the numeric code, exception type and — for a non-ClickHouse
 * error — the primitive system fields are ever surfaced. Split out of
 * `clickhouseStatementRunner.ts` by issue #8274; these cases exercised the
 * same functions in that file before the move.
 *
 * @see ../clickhouseErrors.ts
 * @see ../__tests__/accessModelLogging.unit.test.ts — the password-leak guard
 *   on `clickHouseErrorSummary` specifically
 * @see specs/lwql/api.feature
 */

import { describe, expect, it } from "vitest";

import {
  clickHouseErrorCode,
  clickHouseErrorSummary,
} from "../clickhouseErrors";

describe("clickHouseErrorCode", () => {
  it("reads a numeric string .code, as @clickhouse/client throws it", () => {
    expect(clickHouseErrorCode({ code: "495" })).toBe(495);
  });

  it("reads a numeric .code", () => {
    expect(clickHouseErrorCode({ code: 495 })).toBe(495);
  });

  it("falls back to a 'Code: NNN.' prefix in the message for a raw HTTP error", () => {
    expect(
      clickHouseErrorCode(new Error("Code: 495. DB::Exception: Access denied")),
    ).toBe(495);
  });

  it("returns null when neither a .code nor a Code: prefix is present", () => {
    expect(clickHouseErrorCode(new Error("connect ECONNREFUSED"))).toBeNull();
    expect(clickHouseErrorCode("not an error at all")).toBeNull();
  });

  it("ignores a non-numeric .code string rather than misreading it", () => {
    expect(clickHouseErrorCode({ code: "P2010" })).toBeNull();
  });
});

describe("clickHouseErrorSummary", () => {
  describe("given a ClickHouse-shaped error", () => {
    it("summarises to the numeric code and exception type only", () => {
      const error = Object.assign(new Error("Code: 495. DB::Exception: x"), {
        code: "495",
        type: "DB::Exception",
      });

      expect(clickHouseErrorSummary(error)).toEqual({
        code: 495,
        type: "DB::Exception",
      });
    });

    it("falls back to the error's constructor name when it carries no .type", () => {
      class FakeClickHouseError extends Error {}
      const error = Object.assign(new FakeClickHouseError("Code: 669. x"), {
        code: "669",
      });

      const summary = clickHouseErrorSummary(error);
      expect(summary.code).toBe(669);
      expect(summary.type).toBe("FakeClickHouseError");
    });
  });

  describe("given a non-ClickHouse error", () => {
    it("carries only the safe system primitives, never the message", () => {
      const error = Object.assign(
        new Error("connect ECONNREFUSED 127.0.0.1:8123"),
        {
          code: "ECONNREFUSED",
          errno: -61,
          syscall: "connect",
        },
      );

      expect(clickHouseErrorSummary(error)).toEqual({
        code: null,
        type: "Error",
        systemCode: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
      });
    });

    it("omits a system field the error does not carry, rather than null-filling it", () => {
      const summary = clickHouseErrorSummary(new Error("boom"));
      expect(summary).toEqual({ code: null, type: "Error" });
      expect(summary).not.toHaveProperty("systemCode");
      expect(summary).not.toHaveProperty("errno");
      expect(summary).not.toHaveProperty("syscall");
    });
  });

  it("never includes the message, even one carrying an escaped password", () => {
    const secret = "s3cr3t-lwql-password";
    const error = Object.assign(
      new Error(
        `CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY '${secret}'`,
      ),
      { code: "495" },
    );

    expect(JSON.stringify(clickHouseErrorSummary(error))).not.toContain(secret);
  });
});
