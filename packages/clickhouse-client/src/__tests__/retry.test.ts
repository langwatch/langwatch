import { describe, expect, it, vi } from "vitest";
import type { QueryRequest } from "../query";
import { RetryPolicy, runWithRetry } from "../retry";

const request: QueryRequest = {
  tenantId: "project_1",
  sql: "SELECT 1 FROM t WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_1" },
};

const transient = () => Object.assign(new Error("socket"), { code: "ECONNRESET" });
const permanent = () => new Error("Code: 62. DB::Exception: Syntax error");

/** Never actually waits, and records what the delays would have been. */
const fakeSleep = () => {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
};

describe("runWithRetry", () => {
  describe("given a degenerate attempt budget", () => {
    describe("when the operation is run", () => {
      it.each([0, -1, 2.5])(
        "refuses %s rather than throwing an undefined",
        async (maxAttempts) => {
          // The loop would never run and `throw lastError` would throw
          // `undefined` - no message, no stack, and every instanceof handler
          // upstream misses it.
          await expect(
            runWithRetry(async () => "ok", { maxAttempts }),
          ).rejects.toBeInstanceOf(RangeError);
        },
      );
    });
  });
});

describe("retry", () => {
  describe("given a transient failure that then succeeds", () => {
    describe("when the statement is executed", () => {
      it("returns the eventual result", async () => {
        const { sleep } = fakeSleep();
        const next = vi
          .fn()
          .mockRejectedValueOnce(transient())
          .mockResolvedValue({ rows: ["ok"] });

        const result = await new RetryPolicy({ sleep, random: () => 0 }).run(
          () => (next as never)(request),
          { request },
        );

        expect(result.rows).toEqual(["ok"]);
        expect(next).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a permanent failure", () => {
    describe("when the statement is executed", () => {
      it("fails on the first attempt instead of spending the budget", async () => {
        // Retrying a syntax error costs the full budget and, when the failure
        // is an overload the retries caused, makes the overload worse.
        const { sleep } = fakeSleep();
        const next = vi.fn().mockRejectedValue(permanent());

        await expect(
          new RetryPolicy({ sleep }).run(() => (next as never)(request), {
            request: request,
          }),
        ).rejects.toThrow(/Syntax error/);
        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a failure that never clears", () => {
    describe("when the attempt budget runs out", () => {
      it("stops at the attempt budget", async () => {
        const { sleep } = fakeSleep();
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({ maxAttempts: 3, sleep }).run(() => (next as never)(request), {
            request: request,
          }),
        ).rejects.toThrow("socket");
        expect(next).toHaveBeenCalledTimes(3);
      });

      it("backs off exponentially between attempts", async () => {
        const { delays, sleep } = fakeSleep();
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({
            maxAttempts: 4,
            baseDelayMs: 100,
            maxDelayMs: 10_000,
            sleep,
            random: () => 0,
          }).run(() => (next as never)(request), { request: request }),
        ).rejects.toThrow();

        expect(delays).toEqual([100, 200, 400]);
      });
    });
  });

  describe("given the caller has aborted", () => {
    describe("when the abort lands during the attempt", () => {
      it("stops retrying, because nobody is waiting for the answer", async () => {
        const { sleep } = fakeSleep();
        const controller = new AbortController();
        const next = vi.fn().mockImplementation(() => {
          controller.abort();
          return Promise.reject(transient());
        });

        await expect(
          new RetryPolicy({ maxAttempts: 5, sleep }).run(
            () =>
              (next as never)({
                ...request,
                signal: controller.signal,
              }),
            {
              request: {
                ...request,
                signal: controller.signal,
              },
            },
          ),
        ).rejects.toThrow("socket");
        expect(next).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the abort lands during the backoff", () => {
      it("does not start another attempt after the wait", async () => {
        // A backoff can be tens of seconds. Checking only before the sleep
        // means a caller that gave up during it still pays for one more
        // attempt, against a server that is usually already struggling.
        const controller = new AbortController();
        const next = vi.fn().mockRejectedValue(transient());
        const sleep = async () => {
          controller.abort();
        };

        await expect(
          new RetryPolicy({ maxAttempts: 5, sleep }).run(
            () =>
              (next as never)({
                ...request,
                signal: controller.signal,
              }),
            {
              request: {
                ...request,
                signal: controller.signal,
              },
            },
          ),
        ).rejects.toThrow("socket");
        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given retries happen", () => {
    describe("when the failure repeats", () => {
      it("warns once and stays quiet after", async () => {
        // A 25-attempt budget previously produced 25 warnings for one failure.
        const { sleep } = fakeSleep();
        const notices: string[] = [];
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({
            maxAttempts: 5,
            sleep,
            onRetry: (notice) => notices.push(notice.level),
          }).run(() => (next as never)(request), { request: request }),
        ).rejects.toThrow();

        expect(notices.filter((level) => level === "warn")).toHaveLength(1);
        expect(notices).toHaveLength(4);
      });

      it("reports the statement's tenant on every notice", async () => {
        const { sleep } = fakeSleep();
        const onRetry = vi.fn();
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({ maxAttempts: 2, sleep, onRetry }).run(
            () => (next as never)(request),
            { request: request },
          ),
        ).rejects.toThrow();

        expect(onRetry).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({ tenantId: "project_1" }),
          }),
        );
      });
    });

    describe("when the retry notice itself throws", () => {
      it("still reports the ClickHouse failure, not the logging one", async () => {
        // `onRetry` is host code on the query's own path. Unguarded, a broken
        // logger replaces the error the caller needs to diagnose with one
        // about the logger.
        const { sleep } = fakeSleep();
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({
            maxAttempts: 3,
            sleep,
            onRetry: () => {
              throw new Error("the metrics registry is misconfigured");
            },
          }).run(() => (next as never)(request), { request: request }),
        ).rejects.toThrow("socket");
      });

      it("still spends the remaining attempts", async () => {
        const { sleep } = fakeSleep();
        const next = vi.fn().mockRejectedValue(transient());

        await expect(
          new RetryPolicy({
            maxAttempts: 3,
            sleep,
            onRetry: () => {
              throw new Error("the metrics registry is misconfigured");
            },
          }).run(() => (next as never)(request), { request: request }),
        ).rejects.toThrow();

        expect(next).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("given a caller-supplied transient fragment", () => {
    describe("when a ClickHouse overload is returned", () => {
      it("retries an overload the classifier would otherwise reject", async () => {
        // Retrying this is only safe because the caller opts in per pipeline
        // and composes `rateLimit` outside `retry`: the slot is held across
        // attempts, so a retried overload waits in the limiter rather than
        // going straight back at the server. That ordering is what stops this
        // becoming the 2026-07-31 loop, where rejections were classified as
        // transient and the retries went back into the same wall.
        const { sleep } = fakeSleep();
        const next = vi
          .fn()
          .mockRejectedValueOnce(new Error("Code: 202. Too many simultaneous queries."))
          .mockResolvedValue({ rows: [] });

        await new RetryPolicy({
          sleep,
          transientMessageFragments: ["Too many simultaneous queries"],
        }).run(() => (next as never)(request), { request: request });

        expect(next).toHaveBeenCalledTimes(2);
      });
    });
  });
});
