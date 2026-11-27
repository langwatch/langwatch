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
});
