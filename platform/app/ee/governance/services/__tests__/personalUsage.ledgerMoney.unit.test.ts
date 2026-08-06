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
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalUsageService } from "../personalUsage.service";

const getClickHouseClientForProject = vi.hoisted(() => vi.fn());

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: (projectId: string) =>
    getClickHouseClientForProject(projectId),
  isClickHouseEnabled: () => true,
}));

const LEDGER_TABLE = "gateway_budget_ledger_events";

/** Every query the service issued, in order. */
let issued: string[] = [];

/**
 * A client that answers ledger reads from `nanoRows` and every other read
 * (the trace_summaries path) with an empty result, so the assertions below
 * are about the ledger union alone.
 */
function createClient(nanoRows: Record<string, unknown>[]) {
  return {
    query: vi.fn(async ({ query }: { query: string }) => {
      issued.push(query);
      const rows = query.includes(LEDGER_TABLE) ? nanoRows : [];
      return { json: vi.fn().mockResolvedValue(rows) };
    }),
  };
}

/** The queries that read the ledger, which is where the money rule applies. */
function ledgerQueries(): string[] {
  return issued.filter((query) => query.includes(LEDGER_TABLE));
}

const window = {
  start: new Date("2026-08-01T00:00:00.000Z"),
  end: new Date("2026-09-01T00:00:00.000Z"),
};

const input = {
  personalProjectId: "personal-project",
  userId: "user-1",
  ingestionTenantId: "governance-project",
  window,
};

beforeEach(() => {
  issued = [];
  getClickHouseClientForProject.mockReset();
});

describe("PersonalUsageService ingestion-ledger money", () => {
  describe("when the window holds debits smaller than one micro-USD", () => {
    it("totals them exactly instead of rounding each one away", async () => {
      // 2,000 requests at 450 nano-USD each. Rounded to micro-USD first,
      // every one of them is 0.000000 and the month reads as free.
      const client = createClient([
        {
          TotalNanoCost: "900000",
          RequestCount: 2000,
          PromptTokens: 20,
          CompletionTokens: 10,
        },
      ]);
      getClickHouseClientForProject.mockResolvedValue(client);

      const summary = await new PersonalUsageService().summary(input);

      expect(summary.spentUsd).toBe(0.0009);
      expect(summary.billedUsd).toBe(0.0009);
    });
  });

  describe("when a summed total exceeds the safe integer range", () => {
    it("refuses the figure rather than publishing one that lost its digits", async () => {
      const client = createClient([
        {
          TotalNanoCost: "90071992547409910",
          RequestCount: 1,
          PromptTokens: 0,
          CompletionTokens: 0,
        },
      ]);
      getClickHouseClientForProject.mockResolvedValue(client);

      // The union swallows its own failures so the dashboard still renders
      // the trace-summary side; what must not happen is a wrong number.
      const summary = await new PersonalUsageService().summary(input);

      expect(summary.spentUsd).toBe(0);
    });
  });

  describe("when any ledger read runs", () => {
    it("sums the integer money column and never the decimal one", async () => {
      const client = createClient([]);
      getClickHouseClientForProject.mockResolvedValue(client);
      const service = new PersonalUsageService();

      await service.summary(input);
      await service.dailyBuckets(input);
      await service.breakdownByModel(input);

      expect(ledgerQueries().length).toBeGreaterThanOrEqual(3);
      for (const query of ledgerQueries()) {
        expect(query).toContain("any(AmountNanoUSD)");
        expect(query).not.toContain("any(AmountUSD)");
        expect(query).not.toContain("sum(RequestAmountUSD)");
      }
    });

    it("counts successful debits only, as every other ledger read does", async () => {
      const client = createClient([]);
      getClickHouseClientForProject.mockResolvedValue(client);
      const service = new PersonalUsageService();

      await service.summary(input);
      await service.dailyBuckets(input);
      await service.breakdownByModel(input);

      for (const query of ledgerQueries()) {
        expect(query).toContain("Status = 'success'");
      }
    });
  });

  describe("when the per-day and per-model reads answer", () => {
    it("converts each summed nano total to its exact USD figure", async () => {
      const client = createClient([
        { Day: "2026-08-03", SpentNanoUsd: "1234567", Requests: 3 },
      ]);
      getClickHouseClientForProject.mockResolvedValue(client);
      const service = new PersonalUsageService();

      const buckets = await service.dailyBuckets(input);
      const day = buckets.find((b) => b.day === "2026-08-03");
      expect(day?.spentUsd).toBe(0.001234567);

      issued = [];
      const breakdown = await service.breakdownByModel({
        ...input,
      });
      expect(breakdown[0]?.spentUsd).toBe(0.001234567);
    });
  });
});
