import { describe, expect, it, vi } from "vitest";
import type { QueryRequest } from "./pipeline";
import { retry } from "./retry";

const request: QueryRequest = {
  tenantId: "project_1",
  sql: "SELECT 1 FROM t WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_1" },
};

const transient = () =>
  Object.assign(new Error("socket"), { code: "ECONNRESET" });
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

describe("retry", () => {
  describe("given a transient failure that then succeeds", () => {
    it("returns the eventual result", async () => {
      const { sleep } = fakeSleep();
      const next = vi
        .fn()
        .mockRejectedValueOnce(transient())
        .mockResolvedValue({ rows: ["ok"] });

      const result = await retry({ sleep, random: () => 0 })(next as never)(
        request,
      );

      expect(result.rows).toEqual(["ok"]);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a permanent failure", () => {
    it("fails on the first attempt instead of spending the budget", async () => {
      // Retrying a syntax error costs the full budget and, when the failure is
      // an overload the retries caused, makes the overload worse.
      const { sleep } = fakeSleep();
      const next = vi.fn().mockRejectedValue(permanent());

      await expect(retry({ sleep })(next as never)(request)).rejects.toThrow(
        /Syntax error/,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a failure that never clears", () => {
    it("stops at the attempt budget", async () => {
      const { sleep } = fakeSleep();
      const next = vi.fn().mockRejectedValue(transient());

      await expect(
        retry({ maxAttempts: 3, sleep })(next as never)(request),
      ).rejects.toThrow("socket");
      expect(next).toHaveBeenCalledTimes(3);
    });

    it("backs off exponentially between attempts", async () => {
      const { delays, sleep } = fakeSleep();
      const next = vi.fn().mockRejectedValue(transient());

      await expect(
        retry({
          maxAttempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 10_000,
          sleep,
          random: () => 0,
        })(next as never)(request),
      ).rejects.toThrow();

      expect(delays).toEqual([100, 200, 400]);
    });
  });

  describe("given the caller has aborted", () => {
    it("stops retrying, because nobody is waiting for the answer", async () => {
      const { sleep } = fakeSleep();
      const controller = new AbortController();
      const next = vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(transient());
      });

      await expect(
        retry({ maxAttempts: 5, sleep })(next as never)({
          ...request,
          signal: controller.signal,
        }),
      ).rejects.toThrow("socket");
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("given retries happen", () => {
    it("warns once and stays quiet after", async () => {
      // A 25-attempt budget previously produced 25 warnings for one failure.
      const { sleep } = fakeSleep();
      const notices: string[] = [];
      const next = vi.fn().mockRejectedValue(transient());

      await expect(
        retry({
          maxAttempts: 5,
          sleep,
          onRetry: (notice) => notices.push(notice.level),
        })(next as never)(request),
      ).rejects.toThrow();

      expect(notices.filter((level) => level === "warn")).toHaveLength(1);
      expect(notices).toHaveLength(4);
    });

    it("reports the statement's tenant on every notice", async () => {
      const { sleep } = fakeSleep();
      const onRetry = vi.fn();
      const next = vi.fn().mockRejectedValue(transient());

      await expect(
        retry({ maxAttempts: 2, sleep, onRetry })(next as never)(request),
      ).rejects.toThrow();

      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ tenantId: "project_1" }),
        }),
      );
    });
  });

  describe("given a caller-supplied transient fragment", () => {
    it("retries a ClickHouse overload the classifier would otherwise reject", async () => {
      const { sleep } = fakeSleep();
      const next = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("Code: 202. Too many simultaneous queries."),
        )
        .mockResolvedValue({ rows: [] });

      await retry({
        sleep,
        transientMessageFragments: ["Too many simultaneous queries"],
      })(next as never)(request);

      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});
