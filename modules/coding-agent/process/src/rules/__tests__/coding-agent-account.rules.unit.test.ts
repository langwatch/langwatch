/**
 * The subscription-account week, built from grouped rows the way the read hands them over.
 * @see specs/coding-agent/account-burndown.feature
 */
import { describe, expect, it } from "vitest";

import type { AccountUsageGroupRow } from "../../repositories/coding-agent-session-event.repository.ts";
import {
  accountColumnsOf,
  accountWeekWindow,
  buildAccountBurndowns,
  shortAccountName,
} from "../coding-agent-account.rules.ts";

const NOW_MS = Date.parse("2026-11-26T12:00:00.000Z");
const { days } = accountWeekWindow(NOW_MS);
const ACCOUNT = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

function group(over: Partial<AccountUsageGroupRow> = {}): AccountUsageGroupRow {
  return {
    accountId: ACCOUNT,
    day: "2026-11-26",
    agent: "claude_code",
    model: "claude-opus-5-5",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    rateLimitEvents: 0,
    name: null,
    source: null,
    reading: null,
    ...over,
  };
}

function reading(over: Partial<NonNullable<AccountUsageGroupRow["reading"]>>) {
  return {
    percent: null,
    window: null,
    resetsAtMs: null,
    readAtMs: null,
    limitedUntilMs: null,
    atMs: NOW_MS,
    ...over,
  };
}

function build(groups: AccountUsageGroupRow[], canSeeCosts = true) {
  return buildAccountBurndowns({ groups, days, canSeeCosts, nowMs: NOW_MS });
}

describe("accountWeekWindow", () => {
  describe("given a report with only a window and a read time", () => {
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

  it("covers seven UTC days ending today, oldest first", () => {
    const window = accountWeekWindow(NOW_MS);

    expect(window.days).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
    ]);
    expect(window.fromMs).toBe(Date.parse("2026-11-20T00:00:00.000Z"));
  });
});

describe("buildAccountBurndowns", () => {
  describe("given an account its owner never named", () => {
    /** @scenario an account with no name is shown by a short form of its id */
    it("calls it by the first eight characters of its id", () => {
      const [account] = build([group()]);

      expect(account?.name).toBe("Account 0f1e2d3c");
      expect(shortAccountName("c0ffee00-0000-4000-8000-000000000001")).toBe("Account c0ffee00");
    });
  });

  describe("given two readings on different days", () => {
    /** @scenario the reading is the newest one the account reported */
    it("shows the newest one, and an ended limit is no longer shown", () => {
      const [account] = build([
        group({
          day: "2026-11-25",
          reading: reading({
            percent: 40,
            window: "seven_day",
            limitedUntilMs: NOW_MS + 60_000,
            atMs: NOW_MS - 86_400_000,
          }),
        }),
        group({
          reading: reading({
            percent: 72,
            window: "seven_day",
            resetsAtMs: NOW_MS + 2 * 86_400_000,
            readAtMs: NOW_MS - 60_000,
            atMs: NOW_MS - 60_000,
          }),
        }),
      ]);

      expect(account?.reading).toEqual({
        percent: 72,
        window: "seven_day",
        resetsAtMs: NOW_MS + 2 * 86_400_000,
        readAtMs: NOW_MS - 60_000,
        limitedUntilMs: null,
      });
    });

    it("drops a limit that has already passed", () => {
      const [account] = build([group({ reading: reading({ limitedUntilMs: NOW_MS - 1 }) })]);

      expect(account?.reading?.limitedUntilMs).toBeNull();
    });

    it("keeps a limit that has not passed yet", () => {
      const [account] = build([group({ reading: reading({ limitedUntilMs: NOW_MS + 1 }) })]);

      expect(account?.reading?.limitedUntilMs).toBe(NOW_MS + 1);
    });
  });

  describe("given rows that never reported a percent", () => {
    /** @scenario no percent is shown when none was reported */
    it("carries no reading at all", () => {
      const [account] = build([group({ inputTokens: 500 })]);

      expect(account?.reading).toBeNull();
    });
  });

  describe("given model calls across the week", () => {
    /** @scenario the week shows tokens and cost per day */
    it("buckets tokens and cost per UTC day and totals the week", () => {
      const [account] = build([
        group({ day: "2026-11-20", inputTokens: 10, outputTokens: 5, costUsd: 0.5 }),
        group({ day: "2026-11-26", cacheReadTokens: 100, cacheWriteTokens: 20, costUsd: 1 }),
        group({ day: "2026-11-26", model: "", rateLimitEvents: 2 }),
      ]);

      expect(account?.days).toHaveLength(7);
      expect(account?.days[0]).toEqual({
        day: "2026-11-20",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.5,
      });
      expect(account?.days[3]?.inputTokens).toBe(0);
      expect(account?.totals.totalTokens).toBe(135);
      expect(account?.totals.costUsd).toBeCloseTo(1.5);
      expect(account?.rateLimitEvents).toBe(2);
    });

    it("leaves the cost out for a viewer who may not see costs", () => {
      const [account] = build([group({ inputTokens: 10, costUsd: 0.5 })], false);

      expect(account?.totals.costUsd).toBeNull();
      expect(account?.days.every((day) => day.costUsd === null)).toBe(true);
      expect(account?.totals.totalTokens).toBe(10);
    });
  });

  describe("given Claude Code and Codex on the same account", () => {
    /** @scenario each account says which agents ran on it */
    it("lists both agents and its models by tokens", () => {
      const [account] = build([
        group({ agent: "claude_code", model: "claude-opus-5-5", inputTokens: 900 }),
        group({ agent: "codex", model: "gpt-6.1", inputTokens: 100 }),
        group({ agent: "claude_code", model: "claude-sonnet-5", inputTokens: 300 }),
      ]);

      expect(account?.agents).toEqual(["claude_code", "codex"]);
      expect(account?.topModels).toEqual(["claude-opus-5-5", "claude-sonnet-5", "gpt-6.1"]);
    });
  });

  it("takes the newest name and source, and orders accounts by name", () => {
    const accounts = build([
      group({ accountId: "b", name: { value: "ACME Max 2", atMs: 1 } }),
      group({
        accountId: "a",
        name: { value: "Old name", atMs: 1 },
        source: { value: "personal", atMs: 1 },
      }),
      group({
        accountId: "a",
        day: "2026-11-25",
        name: { value: "ACME Max 1", atMs: 2 },
        source: { value: "pool", atMs: 2 },
      }),
    ]);

    expect(accounts.map((account) => account.name)).toEqual(["ACME Max 1", "ACME Max 2"]);
    expect(accounts[0]?.source).toBe("pool");
  });
});
