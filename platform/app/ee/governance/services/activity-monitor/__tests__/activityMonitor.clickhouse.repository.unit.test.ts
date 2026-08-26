/**
 * Regression test: proves the Zod validation boundary between ClickHouse
 * and application catches the three risks from langwatch-saas#1091:
 *
 * 1. Silent type mismatch — CH returns strings for aggregated numerics
 *    (`sum()`, `count()`). The old `as Array<{...}>` cast didn't coerce.
 * 2. Null propagation — a LEFT JOIN or empty aggregate can produce null
 *    where the interface said `string`. No `.catch()` or `.default()`.
 * 3. Schema drift — if a CH column is renamed, the cast silently succeeds
 *    and the bug surfaces downstream.
 *
 * Each test builds a repository whose injected resolver hands back a mock
 * ClickHouse client serving the given rows, through the same constructor
 * contract production uses.
 */
import { describe, expect, it, vi } from "vitest";

import { ActivityMonitorClickHouseRepository } from "../activityMonitor.clickhouse.repository";

function makeRepo(rows: unknown[]) {
  const ch = {
    query: vi.fn(async () => ({
      json: async () => rows,
    })),
  } as never;
  return new ActivityMonitorClickHouseRepository(async () => ch);
}

describe("ActivityMonitorClickHouseRepository", () => {
  describe("when CH returns string-typed numerics (risk #1: silent type mismatch)", () => {
    it("coerces summary spend strings to numbers", async () => {
      const repo = makeRepo([
        { thisSpend: "1.5", prevSpend: "0.75", thisUsers: "3" },
      ]);

      const row = await repo.findSummarySpend({
        tenantId: "t",
        thisStart: 0,
        prevStart: 0,
      });

      expect(row).toEqual({ thisSpend: 1.5, prevSpend: 0.75, thisUsers: 3 });
      expect(typeof row.thisSpend).toBe("number");
      expect(typeof row.prevSpend).toBe("number");
      expect(typeof row.thisUsers).toBe("number");
    });

    it("coerces window count strings to numbers", async () => {
      const repo = makeRepo([
        { c24: "42", c7: "200", c30: "800", lastMs: "1700000000000" },
      ]);

      const row = await repo.findTracedEventWindowCounts({
        tenantId: "t",
        sourceId: "s",
        since24h: 0,
        since7d: 0,
        since30d: 0,
      });

      expect(row).toEqual({
        c24: 42,
        c7: 200,
        c30: 800,
        lastMs: "1700000000000",
      });
      expect(typeof row!.c24).toBe("number");
    });

    it("coerces pushed event numeric fields from CH number to typed output", async () => {
      const repo = makeRepo([
        {
          eventId: "e1",
          eventType: "otel_generic",
          actor: "user@test.com",
          target: "gpt-5",
          costUsd: 0.01,
          tokensInput: 10,
          tokensOutput: 4,
          occurredMs: "1700000000000",
          createdMs: "1700000001000",
        },
      ]);

      const rows = await repo.findPushedEventsForSource({
        tenantId: "t",
        sourceId: "s",
        beforeMs: Date.now(),
        limit: 50,
      });

      expect(rows[0]!.costUsd).toBe("0.01");
      expect(typeof rows[0]!.costUsd).toBe("string");
      expect(rows[0]!.tokensInput).toBe(10);
      expect(typeof rows[0]!.tokensInput).toBe("number");
    });
  });

  describe("when CH returns nulls (risk #2: null propagation)", () => {
    it("defaults null summary values to 0", async () => {
      const repo = makeRepo([
        { thisSpend: null, prevSpend: null, thisUsers: null },
      ]);

      const row = await repo.findSummarySpend({
        tenantId: "t",
        thisStart: 0,
        prevStart: 0,
      });

      expect(row).toEqual({ thisSpend: 0, prevSpend: 0, thisUsers: 0 });
    });

    it("defaults null mostUsedTarget to null (preserved nullable)", async () => {
      const repo = makeRepo([
        {
          actor: "user@test.com",
          spendUsdStr: "1.00",
          requests: "5",
          lastActivityMs: "1700000000000",
          mostUsedTarget: null,
        },
      ]);

      const rows = await repo.findSpendByUser({
        tenantId: "t",
        windowStart: 0,
        sortBy: "spend",
        sortDir: "desc",
        limit: 50,
        offset: 0,
      });

      expect(rows[0]!.mostUsedTarget).toBeNull();
    });

    it("defaults null window count lastMs to null (preserved nullable)", async () => {
      const repo = makeRepo([{ c24: 0, c7: 0, c30: 0, lastMs: null }]);

      const row = await repo.findLoggedEventWindowCounts({
        tenantId: "t",
        sourceId: "s",
        since24h: 0,
        since7d: 0,
        since30d: 0,
      });

      expect(row!.lastMs).toBeNull();
      expect(row!.c24).toBe(0);
    });

    it("returns empty summary when CH returns no rows", async () => {
      const repo = makeRepo([]);

      const row = await repo.findSummarySpend({
        tenantId: "t",
        thisStart: 0,
        prevStart: 0,
      });

      expect(row).toEqual({ thisSpend: 0, prevSpend: 0, thisUsers: 0 });
    });

    it("returns undefined when window count has no rows", async () => {
      const repo = makeRepo([]);

      const row = await repo.findPulledEventWindowCounts({
        tenantId: "t",
        sourceId: "s",
        since24h: 0,
        since7d: 0,
        since30d: 0,
      });

      expect(row).toBeUndefined();
    });
  });

  describe("when CH returns unexpected shapes (risk #3: schema drift)", () => {
    it("falls back to zero when summary columns are renamed", async () => {
      const repo = makeRepo([{ wrong_column: "value" }]);

      // thisSpend/prevSpend/thisUsers are all chNumeric with .catch(0),
      // so a missing field falls back to 0 rather than throwing.
      // This is intentional: individual field defaults are the first defense.
      const row = await repo.findSummarySpend({
        tenantId: "t",
        thisStart: 0,
        prevStart: 0,
      });
      expect(row).toEqual({ thisSpend: 0, prevSpend: 0, thisUsers: 0 });
    });

    it("rejects spend-by-user rows missing a required column", async () => {
      // actor has no .catch() — a missing/renamed column here must fail
      // fast via .parse() rather than silently default, proving risk #3
      // (schema drift) is actually caught, not just the per-field
      // defaulting exercised above.
      const repo = makeRepo([
        { spendUsdStr: "1.00", requests: "5", lastActivityMs: "0" },
      ]);

      await expect(
        repo.findSpendByUser({
          tenantId: "t",
          windowStart: 0,
          sortBy: "spend",
          sortDir: "desc",
          limit: 50,
          offset: 0,
        }),
      ).rejects.toThrow();
    });

    it("catches NaN from garbage numeric input", async () => {
      const repo = makeRepo([
        { thisSpend: "not-a-number", prevSpend: {}, thisUsers: undefined },
      ]);

      const row = await repo.findSummarySpend({
        tenantId: "t",
        thisStart: 0,
        prevStart: 0,
      });

      // .finite().catch(0) rejects NaN/Infinity → defaults to 0
      expect(row.thisSpend).toBe(0);
      expect(row.prevSpend).toBe(0);
      expect(row.thisUsers).toBe(0);
    });

    it("defaults missing optional fields on pushed event rows", async () => {
      const repo = makeRepo([
        {
          eventId: "e1",
          // eventType, actor, target all missing
          occurredMs: "1700000000000",
          createdMs: "1700000001000",
        },
      ]);

      const rows = await repo.findPushedEventsForSource({
        tenantId: "t",
        sourceId: "s",
        beforeMs: Date.now(),
        limit: 50,
      });

      expect(rows[0]!.eventType).toBe("");
      expect(rows[0]!.actor).toBe("");
      expect(rows[0]!.target).toBeNull();
      expect(rows[0]!.costUsd).toBe("0");
      expect(rows[0]!.tokensInput).toBe(0);
    });

    it("defaults missing optional fields on pulled event rows", async () => {
      const repo = makeRepo([
        {
          eventId: "e1",
          // all optional fields missing
          occurredMs: "1700000000000",
          createdMs: "1700000001000",
        },
      ]);

      const rows = await repo.findPulledEventsForSource({
        tenantId: "t",
        sourceId: "s",
        beforeMs: Date.now(),
        limit: 50,
      });

      expect(rows[0]!.actorEmail).toBe("");
      expect(rows[0]!.action).toBe("");
      expect(rows[0]!.rawPayload).toBe("");
    });
  });

  describe("when CH returns well-typed data (happy path)", () => {
    it("passes through spend-by-user rows unchanged", async () => {
      const repo = makeRepo([
        {
          actor: "alice@acme.com",
          spendUsdStr: "42.50",
          requests: "100",
          lastActivityMs: "1700000000000",
          mostUsedTarget: "claude-haiku-4-5",
        },
      ]);

      const rows = await repo.findSpendByUser({
        tenantId: "t",
        windowStart: 0,
        sortBy: "spend",
        sortDir: "desc",
        limit: 50,
        offset: 0,
      });

      expect(rows).toEqual([
        {
          actor: "alice@acme.com",
          spendUsdStr: "42.50",
          requests: "100",
          lastActivityMs: "1700000000000",
          mostUsedTarget: "claude-haiku-4-5",
        },
      ]);
    });

    it("passes through source event counts", async () => {
      const repo = makeRepo([
        { sourceId: "src-1", c: "42" },
        { sourceId: "src-2", c: "7" },
      ]);

      const rows = await repo.countTracedEventsBySource({
        tenantId: "t",
        sourceIds: ["src-1", "src-2"],
        since: 0,
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ sourceId: "src-1", c: "42" });
    });

    it("passes through spend-over-time rows", async () => {
      const repo = makeRepo([
        {
          bucketMs: "1700000000000",
          groupKey: "team-1",
          spendUsdStr: "10.00",
        },
      ]);

      const rows = await repo.findSpendOverTime({
        tenantId: "t",
        windowStart: 0,
        groupBy: "team",
      });

      expect(rows).toEqual([
        {
          bucketMs: "1700000000000",
          groupKey: "team-1",
          spendUsdStr: "10.00",
        },
      ]);
    });
  });
});
