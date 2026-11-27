/**
 * The account columns a usage report fills on each per-call row.
 * @see specs/coding-agent/account-usage.feature
 */
import { describe, expect, it } from "vitest";

import { accountColumnsOf } from "../coding-agent-account.rules.ts";

const ACCOUNT = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

describe("accountColumnsOf", () => {
  describe("given a report with only a window and a read time", () => {
    /** @scenario a window or read time alone is not stored as a reading */
    it("stores no reading, so an older full reading stays the newest", () => {
      const columns = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.usage.window": "seven_day",
        "langwatch.account.usage.read_at": "2026-11-26T11:00:00.000Z",
      });
      expect(columns.accountId).toBe(ACCOUNT);
      expect(columns.accountUsageWindow).toBe("");
      expect(columns.accountUsageReadAtMs).toBeNull();
    });

    it("keeps the window and read time once a percent comes with them", () => {
      const columns = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.usage.percent": 42,
        "langwatch.account.usage.window": "seven_day",
        "langwatch.account.usage.read_at": "2026-11-26T11:00:00.000Z",
      });
      expect(columns.accountUsageWindow).toBe("seven_day");
      expect(columns.accountUsageReadAtMs).toBe(Date.parse("2026-11-26T11:00:00.000Z"));
    });
  });

  describe("given instants in other units or out of range", () => {
    /** @scenario instants are stored in milliseconds whatever unit they were sent in */
    it("reads seconds and nanoseconds as the same instant in milliseconds", () => {
      const atMs = Date.parse("2026-11-28T09:00:00.000Z");
      const inSeconds = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.usage.resets_at": atMs / 1000,
      });
      const inNanos = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.limited_until": atMs * 1_000_000,
      });
      expect(inSeconds.accountUsageResetsAtMs).toBe(atMs);
      expect(inNanos.accountLimitedUntilMs).toBe(atMs);
    });

    /** @scenario an instant no clock could mean is dropped, never failing the write */
    it("drops an instant no clock could mean instead of failing the write", () => {
      const columns = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.usage.percent": 10,
        "langwatch.account.usage.resets_at": "9999-12-31T00:00:00.000Z",
        "langwatch.account.limited_until": Number.MAX_SAFE_INTEGER,
      });
      expect(columns.accountUsageResetsAtMs).toBeNull();
      expect(columns.accountLimitedUntilMs).toBeNull();
      expect(columns.accountUsagePercent).toBe(10);
    });
  });

  describe("given an account id sent as a number", () => {
    /** @scenario the account key falls back to the agent's own account id */
    it("keeps it as the account id, written out", () => {
      expect(accountColumnsOf({ "langwatch.account.id": 4242 }).accountId).toBe("4242");
      expect(accountColumnsOf({ "user.account_id": 17 }).accountId).toBe("17");
      expect(accountColumnsOf({ "user.account_uuid": 99 }).accountId).toBe("99");
    });
  });

  describe("given usage percents in and out of range", () => {
    /** @scenario a percent outside 0 to 100 is not stored */
    it("keeps a numeric string inside the range", () => {
      const columns = accountColumnsOf({
        "langwatch.account.id": ACCOUNT,
        "langwatch.account.usage.percent": " 72.5 ",
      });
      expect(columns.accountUsagePercent).toBe(72.5);
    });

    /** @scenario a percent outside 0 to 100 is not stored */
    it("drops a percent above 100 or below 0, as a number or a string", () => {
      for (const percent of [150, -5, "101", "-0.1"]) {
        const columns = accountColumnsOf({
          "langwatch.account.id": ACCOUNT,
          "langwatch.account.usage.percent": percent,
        });
        expect(columns.accountUsagePercent, String(percent)).toBeNull();
      }
    });
  });
});
