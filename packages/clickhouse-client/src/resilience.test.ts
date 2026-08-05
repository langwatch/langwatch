import { describe, expect, it } from "vitest";
import {
  isTransientClickHouseError,
  jitteredBackoffMs,
  retryNoticeLevel,
} from "./resilience";

const withCode = (message: string, code: string): Error =>
  Object.assign(new Error(message), { code });

const withStatus = (message: string, status: number): Error =>
  Object.assign(new Error(message), { statusCode: status });

describe("isTransientClickHouseError", () => {
  describe("given something that is not an error", () => {
    it.each([
      ["a string", "ECONNRESET"],
      ["null", null],
      ["undefined", undefined],
      ["a plain object", { code: "ECONNRESET" }],
    ])("treats %s as permanent", (_label, value) => {
      expect(isTransientClickHouseError(value)).toBe(false);
    });
  });

  describe("given a socket-level failure", () => {
    it.each(["ECONNRESET", "EPIPE", "ETIMEDOUT", "EAI_AGAIN"])(
      "retries %s",
      (code) => {
        expect(isTransientClickHouseError(withCode("socket", code))).toBe(true);
      },
    );

    it("does not retry an unrecognised code", () => {
      expect(isTransientClickHouseError(withCode("nope", "EACCES"))).toBe(
        false,
      );
    });
  });

  describe("given an HTTP status", () => {
    it.each([429, 502, 503])("retries %s", (status) => {
      expect(isTransientClickHouseError(withStatus("busy", status))).toBe(true);
    });

    it.each([400, 401, 404, 500])("does not retry %s", (status) => {
      expect(isTransientClickHouseError(withStatus("nope", status))).toBe(
        false,
      );
    });
  });

  describe("given a timeout", () => {
    it("retries on the message alone", () => {
      expect(isTransientClickHouseError(new Error("Timeout error."))).toBe(
        true,
      );
    });
  });

  describe("given caller-supplied transient fragments", () => {
    it("retries a message that contains one", () => {
      const error = new Error("Code: 202. Too many simultaneous queries.");

      expect(
        isTransientClickHouseError(error, {
          transientMessageFragments: ["Too many simultaneous queries"],
        }),
      ).toBe(true);
    });

    it("does not retry it when the caller supplies no fragments", () => {
      const error = new Error("Code: 202. Too many simultaneous queries.");

      expect(isTransientClickHouseError(error)).toBe(false);
    });
  });

  describe("given a query the server will never accept", () => {
    it("fails fast rather than spending the budget", () => {
      const syntaxError = new Error("Code: 62. DB::Exception: Syntax error");

      expect(isTransientClickHouseError(syntaxError)).toBe(false);
    });
  });
});

describe("jitteredBackoffMs", () => {
  const base = { baseDelayMs: 500, maxDelayMs: 600_000, random: () => 0 };

  describe("given no jitter", () => {
    it("doubles with each attempt", () => {
      expect(jitteredBackoffMs({ ...base, attempt: 0 })).toBe(500);
      expect(jitteredBackoffMs({ ...base, attempt: 1 })).toBe(1000);
      expect(jitteredBackoffMs({ ...base, attempt: 2 })).toBe(2000);
    });
  });

  describe("given full jitter", () => {
    it("adds at most one base delay", () => {
      expect(jitteredBackoffMs({ ...base, attempt: 0, random: () => 1 })).toBe(
        1000,
      );
    });
  });

  describe("given enough attempts to overflow", () => {
    it("clamps to the maximum", () => {
      expect(jitteredBackoffMs({ ...base, attempt: 40 })).toBe(600_000);
    });

    it("never exceeds the maximum whatever the jitter", () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const delay = jitteredBackoffMs({ ...base, attempt, random: () => 1 });
        expect(delay).toBeLessThanOrEqual(600_000);
      }
    });
  });
});

describe("retryNoticeLevel", () => {
  describe("given the first attempt", () => {
    it("warns once", () => {
      expect(retryNoticeLevel(0)).toBe("warn");
    });
  });

  describe("given a later attempt", () => {
    it("stays quiet so one failure is not counted many times", () => {
      // A 25-attempt budget previously produced 25 warn records per failure.
      const levels = Array.from({ length: 25 }, (_, i) => retryNoticeLevel(i));

      expect(levels.filter((l) => l === "warn")).toHaveLength(1);
    });
  });
});
