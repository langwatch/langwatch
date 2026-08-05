import { describe, expect, it } from "vitest";
import {
  isTransientClickHouseError,
  jitteredBackoffMs,
  retryNoticeLevel,
} from "./resilience";

const withCode = ({
  message,
  code,
}: {
  message: string;
  code: string;
}): Error => Object.assign(new Error(message), { code });

const withStatus = ({
  message,
  status,
}: {
  message: string;
  status: number;
}): Error => Object.assign(new Error(message), { statusCode: status });

describe("isTransientClickHouseError", () => {
  describe("given something that is not an error", () => {
    describe("when classified", () => {
      it.each([
        ["a string", "ECONNRESET"],
        ["null", null],
        ["undefined", undefined],
        ["a plain object", { code: "ECONNRESET" }],
      ])("treats %s as permanent", (_label, value) => {
        expect(isTransientClickHouseError({ error: value })).toBe(false);
      });
    });
  });

  describe("given a socket-level failure", () => {
    describe("when the code is a known transient one", () => {
      it.each(["ECONNRESET", "EPIPE", "ETIMEDOUT", "EAI_AGAIN"])(
        "retries %s",
        (code) => {
          expect(
            isTransientClickHouseError({ error: withCode({ message: "socket", code }) }),
          ).toBe(true);
        },
      );
    });

    describe("when the code is not recognised", () => {
      it("does not retry", () => {
        expect(
          isTransientClickHouseError({
            error: withCode({ message: "nope", code: "EACCES" }),
          }),
        ).toBe(false);
      });
    });
  });

  describe("given an HTTP status", () => {
    describe("when the status means busy", () => {
      it.each([429, 502, 503])("retries %s", (status) => {
        expect(
          isTransientClickHouseError({ error: withStatus({ message: "busy", status }) }),
        ).toBe(true);
      });
    });

    describe("when the status means permanent rejection", () => {
      it.each([400, 401, 404, 500])("does not retry %s", (status) => {
        expect(
          isTransientClickHouseError({ error: withStatus({ message: "nope", status }) }),
        ).toBe(false);
      });
    });
  });

  describe("given a timeout", () => {
    describe("when only the message says so", () => {
      it("retries on the message alone", () => {
        expect(
          isTransientClickHouseError({ error: new Error("Timeout error.") }),
        ).toBe(true);
      });
    });
  });

  describe("given caller-supplied transient fragments", () => {
    describe("when the message contains one", () => {
      it("retries", () => {
        const error = new Error("Code: 202. Too many simultaneous queries.");

        expect(
          isTransientClickHouseError({
            error,
            transientMessageFragments: ["Too many simultaneous queries"],
          }),
        ).toBe(true);
      });
    });

    describe("when the caller supplies no fragments", () => {
      it("does not retry", () => {
        const error = new Error("Code: 202. Too many simultaneous queries.");

        expect(isTransientClickHouseError({ error })).toBe(false);
      });
    });
  });

  describe("given a query the server will never accept", () => {
    describe("when the failure is a syntax error", () => {
      it("fails fast rather than spending the budget", () => {
        const syntaxError = new Error("Code: 62. DB::Exception: Syntax error");

        expect(isTransientClickHouseError({ error: syntaxError })).toBe(false);
      });
    });
  });
});

describe("jitteredBackoffMs", () => {
  const base = { baseDelayMs: 500, maxDelayMs: 600_000, random: () => 0 };

  describe("given no jitter", () => {
    describe("when the attempt increases", () => {
      it("doubles with each attempt", () => {
        expect(jitteredBackoffMs({ ...base, attempt: 0 })).toBe(500);
        expect(jitteredBackoffMs({ ...base, attempt: 1 })).toBe(1000);
        expect(jitteredBackoffMs({ ...base, attempt: 2 })).toBe(2000);
      });
    });
  });

  describe("given full jitter", () => {
    describe("when the random source always returns 1", () => {
      it("adds at most one base delay", () => {
        expect(
          jitteredBackoffMs({ ...base, attempt: 0, random: () => 1 }),
        ).toBe(1000);
      });
    });
  });

  describe("given an attempt whose exponential delay exceeds the maximum", () => {
    describe("when the delay is computed", () => {
      it("clamps to the maximum", () => {
        expect(jitteredBackoffMs({ ...base, attempt: 40 })).toBe(600_000);
      });

      it("never exceeds the maximum whatever the jitter", () => {
        for (let attempt = 0; attempt < 30; attempt++) {
          const delay = jitteredBackoffMs({
            ...base,
            attempt,
            random: () => 1,
          });
          expect(delay).toBeLessThanOrEqual(600_000);
        }
      });
    });
  });
});

describe("retryNoticeLevel", () => {
  describe("given the first attempt", () => {
    describe("when the level is chosen", () => {
      it("warns once", () => {
        expect(retryNoticeLevel(0)).toBe("warn");
      });
    });
  });

  describe("given a later attempt", () => {
    describe("when the level is chosen", () => {
      it("stays quiet so one failure is not counted many times", () => {
        // A 25-attempt budget previously produced 25 warn records per failure.
        const levels = Array.from({ length: 25 }, (_, i) => retryNoticeLevel(i));

        expect(levels.filter((l) => l === "warn")).toHaveLength(1);
      });
    });
  });
});
