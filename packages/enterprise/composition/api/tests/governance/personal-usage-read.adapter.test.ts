// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ingestion-ledger union reads money the way the ledger says money must be
 * read: summed on the integer `AmountNanoUSD`, filtered to successful debits.
 *
 * The three reads used to sum `AmountUSD`, a `Decimal(18, 6)` the ledger
 * documents as never-summable, so every debit was rounded to a micro-USD
 * before it was added. The fixtures below are chosen so the two answers
 * differ: a run of sub-micro requests reads as zero under the old rule and as
 * its true total under this one.
 *
 * The reads live in the repository since #6622, so that is where the rule is
 * asserted. The service keeps one test of its own: a ledger read that refuses
 * to answer must still leave the trace-summary side of the dashboard standing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppPersonalUsageReadAdapter } from "../../src/governance/personal-usage.clickhouse.repository";

const LEDGER_TABLE = "gateway_budget_ledger_events";

/** Every query the repository issued, in order. */
let issued: string[] = [];

/**
 * A repository whose client answers ledger reads from `nanoRows` and every
 * other read with an empty result, so the assertions are about the ledger
 * union alone.
 */
function createRepository(nanoRows: Record<string, unknown>[]) {
  const client = {
    query: vi.fn(async ({ query }: { query: string }) => {
      issued.push(query);
      const rows = query.includes(LEDGER_TABLE) ? nanoRows : [];
      return { json: vi.fn().mockResolvedValue(rows) };
    }),
  };
  const resolveClient = async () => client;
  return new AppPersonalUsageReadAdapter(resolveClient);
}

/** The queries that read the ledger, which is where the money rule applies. */
function ledgerQueries(): string[] {
  return issued.filter((query) => query.includes(LEDGER_TABLE));
}

const window = {
  start: new Date("2026-08-01T00:00:00.000Z"),
  end: new Date("2026-09-01T00:00:00.000Z"),
};

const params = {
  tenantId: "governance-project",
  userId: "user-1",
  window,
};

beforeEach(() => {
  issued = [];
});

describe("the ingestion-ledger union's money", () => {
  describe("when the window holds debits smaller than one micro-USD", () => {
    it("totals them exactly instead of rounding each one away", async () => {
      // 2,000 requests at 450 nano-USD each. Rounded to micro-USD first,
      // every one of them is 0.000000 and the month reads as free.
      const repository = createRepository([
        {
          TotalNanoCost: "900000",
          RequestCount: 2000,
          PromptTokens: 20,
          CompletionTokens: 10,
        },
      ]);

      const summary = await repository.findIngestionPrincipalSummary(params);

      expect(summary?.totalCost).toBe(0.0009);
    });
  });

  describe("when a summed total exceeds the safe integer range", () => {
    it("refuses the figure rather than publishing one that lost its digits", async () => {
      const repository = createRepository([
        {
          TotalNanoCost: "90071992547409910",
          RequestCount: 1,
          PromptTokens: 0,
          CompletionTokens: 0,
        },
      ]);

      await expect(repository.findIngestionPrincipalSummary(params)).rejects.toThrow();
    });
  });

  describe("when any ledger read runs", () => {
    it("sums the integer money column and never the decimal one", async () => {
      const repository = createRepository([]);

      await repository.findIngestionPrincipalSummary(params);
      await repository.findIngestionPrincipalBuckets(params);
      await repository.findIngestionPrincipalBreakdown(params);

      expect(ledgerQueries().length).toBeGreaterThanOrEqual(3);
      for (const query of ledgerQueries()) {
        expect(query).toContain("any(AmountNanoUSD)");
        expect(query).not.toContain("any(AmountUSD)");
        expect(query).not.toContain("sum(RequestAmountUSD)");
      }
    });

    it("counts successful debits only, as every other ledger read does", async () => {
      const repository = createRepository([]);

      await repository.findIngestionPrincipalSummary(params);
      await repository.findIngestionPrincipalBuckets(params);
      await repository.findIngestionPrincipalBreakdown(params);

      for (const query of ledgerQueries()) {
        expect(query).toContain("Status = 'success'");
      }
    });
  });

  describe("when the per-day and per-model reads answer", () => {
    it("converts each summed nano total to its exact USD figure", async () => {
      const daily = createRepository([
        { Day: "2026-08-03", SpentNanoUsd: "1234567", Requests: 3 },
      ]);
      const buckets = await daily.findIngestionPrincipalBuckets(params);
      expect(buckets.find((b) => b.day === "2026-08-03")?.spentUsd).toBe(0.001234567);

      const perModel = createRepository([
        { Label: "gpt-5-mini", SpentNanoUsd: "1234567", Requests: 3 },
      ]);
      const breakdown = await perModel.findIngestionPrincipalBreakdown(params);
      expect(breakdown[0]?.spentUsd).toBe(0.001234567);
    });
  });
});
