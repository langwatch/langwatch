// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The shape of the metered lane's ledger read, against a stubbed client.
 *
 * What a stub can see is the SQL text and the parameters: that the read is
 * fenced to the organization's tenants, that it collapses the ledger to one
 * row per request before it sums anything, that it never names a person
 * column, and that it carries a deadline under the wire limit. What a stub
 * cannot see — the arithmetic — is in the integration test beside this one.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   ("THE METERED LANE READS THE GATEWAY'S OWN LEDGER")
 */
import { describe, expect, it, vi } from "vitest";

import { GovernanceGatewaySpendClickHouseRepository } from "../governanceGatewaySpend.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

function repositoryOver(rows: unknown[]) {
  const client = makeClient(rows);
  return {
    client,
    repo: new GovernanceGatewaySpendClickHouseRepository(
      async () => client as never,
    ),
  };
}

function queryOf(client: { query: ReturnType<typeof vi.fn> }): string {
  return String(client.query.mock.calls[0]?.[0]?.query ?? "");
}

function callOf(client: { query: ReturnType<typeof vi.fn> }) {
  return client.query.mock.calls[0]?.[0] as {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  };
}

const WINDOW = {
  tenantIds: ["proj_a", "proj_b"],
  fromDay: "2026-08-01",
  toDay: "2026-08-07",
};

/** The three reads, so a rule every one of them must obey is asserted once. */
type ReadInput = typeof WINDOW;
const READS = [
  [
    "by day",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumDaysForOrganizationProjects(input),
  ],
  [
    "by model",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumWindowByModel(input),
  ],
  [
    "by virtual key",
    (repo: GovernanceGatewaySpendClickHouseRepository, input: ReadInput) =>
      repo.sumWindowByVirtualKey(input),
  ],
] as const;

describe("GovernanceGatewaySpendClickHouseRepository", () => {
  describe.each(READS)("when reading the ledger %s", (_label, read) => {
    it("fences the read to the organization's tenants, tenant first", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const call = callOf(client);
      expect(call.query).toContain("TenantId IN {tenantIds:Array(String)}");
      expect(call.query_params.tenantIds).toEqual(["proj_a", "proj_b"]);
      // The tenant predicate leads: nothing else in this table is unique
      // across tenants, and it is the first sort key.
      const where = call.query.indexOf("WHERE");
      const tenant = call.query.indexOf("TenantId IN");
      expect(where).toBeGreaterThan(-1);
      expect(tenant).toBeGreaterThan(where);
      expect(call.query.slice(where, tenant)).not.toMatch(/AND/);
    });

    it("collapses the ledger to one row per request before summing", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const query = queryOf(client);
      // FINAL is not enough: a request folded outcome-first and admitted
      // later sits in two monthly partitions with two OccurredAt values, and
      // FINAL dedups within a partition. The version column decides which
      // row is the request.
      expect(query).not.toMatch(/\bFINAL\b/);
      expect(query).toContain("GROUP BY TenantId, GatewayRequestId");
      expect(query).toContain("argMax(Status, EventTimestamp)");
      expect(query).toContain("argMax(CostNanoUSD, EventTimestamp)");
      expect(query).toContain("argMax(OccurredAt, EventTimestamp)");
    });

    it("counts confirmed and failed requests as spend, and settled ones as unknown", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const query = queryOf(client);
      // A failed request with partial usage is priced and charged.
      expect(query).toContain("IN ('confirmed', 'failed')");
      // An admission whose confirmation never arrived: cost unknown, so it is
      // counted beside the total and adds nothing to it.
      expect(query).toContain("= 'settled'");
      expect(query).toContain("AS RequestsWithoutAmount");
    });

    it("never selects a person column", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      // The ledger sits outside erasure. A person's identifier read from it
      // would outlive a deletion the rest of the product honoured.
      const query = queryOf(client);
      expect(query).not.toContain("PrincipalUserId");
      expect(query).not.toContain("EndUserId");
    });

    it("prunes partitions on the admission time and buckets days in UTC", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      const call = callOf(client);
      expect(call.query).toContain(
        "OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})",
      );
      expect(call.query).toContain(
        "OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})",
      );
      expect(call.query_params.fromMs).toBe(
        Date.parse("2026-08-01T00:00:00.000Z"),
      );
      // Inclusive of the last day: midnight AFTER it, exclusive.
      expect(call.query_params.toMs).toBe(
        Date.parse("2026-08-08T00:00:00.000Z"),
      );
    });

    it("gives the read a deadline under the wire limit", async () => {
      const { client, repo } = repositoryOver([]);
      await read(repo, WINDOW);

      // The managed client abandons a request at 30 s. A query deadline past
      // that is a deadline nothing ever reaches; one under it is the
      // difference between a screen that says it failed and one that hangs.
      expect(callOf(client).clickhouse_settings?.max_execution_time).toBe(20);
    });

    it("issues no query for an organization with no projects", async () => {
      const { client, repo } = repositoryOver([]);
      const rows = await read(repo, { ...WINDOW, tenantIds: [] });

      expect(rows).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("when reading the ledger by day", () => {
    it("buckets on the day the request STARTED, in UTC", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysForOrganizationProjects(WINDOW);

      // A streamed answer running across midnight is one request, on the day
      // the caller asked. The server's own timezone must not move it.
      expect(queryOf(client)).toContain("toDate(RequestOccurredAt, 'UTC')");
    });

    it("decodes the driver's string integers into numbers", async () => {
      const { repo } = repositoryOver([
        {
          Day: "2026-08-01",
          AmountNanoUsd: "3500000",
          RequestCount: "3",
          RequestsWithoutAmount: "2",
        },
      ]);

      const rows = await repo.sumDaysForOrganizationProjects(WINDOW);

      expect(rows).toEqual([
        {
          day: "2026-08-01",
          amountNanoUsd: 3_500_000,
          requestCount: 3,
          requestsWithoutAmount: 2,
        },
      ]);
    });

    it("refuses a day past the safe integer range rather than rounding it", async () => {
      // 2^53 + 1: a Number would silently become 2^53 and a money figure would
      // lose a digit. The guarded parser throws instead, the same rule the
      // gateway's own ledger reads apply.
      const { repo } = repositoryOver([
        {
          Day: "2026-08-01",
          AmountNanoUsd: "9007199254740993",
          RequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);

      await expect(repo.sumDaysForOrganizationProjects(WINDOW)).rejects.toThrow(
        /safe integer range/,
      );
    });
  });

  describe("when reading the breakdowns", () => {
    it("groups by the model and by the virtual key, as the ledger names them", async () => {
      const byModel = repositoryOver([
        {
          Model: "gpt-5-mini",
          AmountNanoUsd: "10",
          RequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);
      const byKey = repositoryOver([
        {
          VirtualKeyId: "vk_1",
          AmountNanoUsd: "10",
          RequestCount: "1",
          RequestsWithoutAmount: "0",
        },
      ]);

      expect(await byModel.repo.sumWindowByModel(WINDOW)).toEqual([
        {
          model: "gpt-5-mini",
          amountNanoUsd: 10,
          requestCount: 1,
          requestsWithoutAmount: 0,
        },
      ]);
      expect(queryOf(byModel.client)).toContain("GROUP BY RequestModel");

      expect(await byKey.repo.sumWindowByVirtualKey(WINDOW)).toEqual([
        {
          virtualKeyId: "vk_1",
          amountNanoUsd: 10,
          requestCount: 1,
          requestsWithoutAmount: 0,
        },
      ]);
      expect(queryOf(byKey.client)).toContain("GROUP BY RequestVirtualKeyId");
    });

    it("ranks by the numeric amount, never by the string the driver ships", async () => {
      // `AmountNanoUsd` is a `toString(...)` alias so the wire never rounds a
      // wide Int64. Ordering on that alias sorts money as TEXT — seen on
      // production: "88986800" ranked above "7619357500". The ORDER BY must
      // go through a numeric expression.
      for (const [, read] of READS.slice(1)) {
        const { client, repo } = repositoryOver([]);
        await read(repo, WINDOW);
        const query = queryOf(client);
        expect(query).not.toMatch(/ORDER BY\s+AmountNanoUsd\b/);
        expect(query).toMatch(/ORDER BY\s+toInt64\(AmountNanoUsd\) DESC/);
      }
    });
  });
});
