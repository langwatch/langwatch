/**
 * The spend read behind a virtual key's usage figures.
 *
 * Everything asserted here is a ClickHouse rule this repo already writes down:
 * every query filters `TenantId` first, every range names the partition column
 * so a read prunes instead of scanning cold storage, and a deduped table is
 * read through `argMax(..., UpdatedAt)` rather than `max()`. None of them are
 * visible from the caller, and all of them are one edit away from a query that
 * still returns numbers — wrong ones, or every tenant's.
 *
 * The client is a fake that keeps the statement it was handed.
 */

import { describe, expect, it } from "vitest";
import { GatewayVirtualKeySpendRepository } from "../clickhouse.gateway-virtual-key-spend.repository";

type Query = { query: string; query_params: Record<string, unknown> };

function repositoryOver(rows: unknown[] = []) {
  const queries: Query[] = [];
  const resolvedFor: string[] = [];
  const client = {
    query: async (q: Query) => {
      queries.push(q);
      return { json: async () => rows };
    },
  };

  return {
    queries,
    resolvedFor,
    repository: new GatewayVirtualKeySpendRepository(async (tenantId: string) => {
      resolvedFor.push(tenantId);
      return client as never;
    }),
  };
}

const WINDOW = {
  fromDate: new Date("2026-08-01T00:00:00.000Z"),
  toDate: new Date("2026-09-01T00:00:00.000Z"),
};

describe("GatewayVirtualKeySpendRepository", () => {
  describe("given nothing to read for", () => {
    describe("when no tenant is named", () => {
      it("answers without resolving a client", async () => {
        const { repository, resolvedFor } = repositoryOver();

        const spend = await repository.spendByVirtualKey({
          tenantIds: [],
          virtualKeyIds: ["vk-1"],
          window: WINDOW,
        });

        expect(spend).toEqual([]);
        expect(resolvedFor).toEqual([]);
      });
    });

    describe("when no virtual key is named", () => {
      it("answers without resolving a client", async () => {
        const { repository, resolvedFor } = repositoryOver();

        const spend = await repository.spendByVirtualKey({
          tenantIds: ["tenant-1"],
          virtualKeyIds: [],
          window: WINDOW,
        });

        expect(spend).toEqual([]);
        expect(resolvedFor).toEqual([]);
      });
    });
  });

  describe("given tenants and keys to read for", () => {
    async function read() {
      const context = repositoryOver([]);
      await context.repository.spendByVirtualKey({
        tenantIds: ["tenant-1", "tenant-2"],
        virtualKeyIds: ["vk-1"],
        window: WINDOW,
      });
      return { ...context, statement: context.queries[0]! };
    }

    describe("when the statement is built", () => {
      it("binds every tenant id as a parameter rather than writing it into the SQL", async () => {
        const { statement } = await read();

        expect(statement.query).toContain("TenantId IN ({tenant0:String},{tenant1:String})");
        expect(statement.query_params.tenant0).toBe("tenant-1");
        expect(statement.query_params.tenant1).toBe("tenant-2");
        expect(statement.query).not.toContain("tenant-1");
      });

      it("binds every virtual key id the same way", async () => {
        const { statement } = await read();

        expect(statement.query).toContain("IN ({vk0:String})");
        expect(statement.query_params.vk0).toBe("vk-1");
        expect(statement.query).not.toContain("vk-1");
      });

      it("bounds the partition column, so the read prunes instead of scanning", async () => {
        const { statement } = await read();

        expect(statement.query).toContain("OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})");
        expect(statement.query).toContain("OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})");
        expect(statement.query_params.fromMs).toBe(WINDOW.fromDate.getTime());
        expect(statement.query_params.toMs).toBe(WINDOW.toDate.getTime());
      });

      it("dedups the summaries by latest version rather than by max", async () => {
        const { statement } = await read();

        // `argMax(col, UpdatedAt)` reads the newest row's value; `max(col)`
        // would mix values from versions that never existed together.
        expect(statement.query).toContain("argMax(coalesce(TotalCost, 0), UpdatedAt)");
        expect(statement.query).toContain("GROUP BY TenantId, TraceId");
        expect(statement.query).not.toMatch(/\bmax\(TotalCost\)/);
      });

      it("resolves the client for one of the tenants it is reading", async () => {
        const { resolvedFor } = await read();

        expect(resolvedFor).toEqual(["tenant-1"]);
      });
    });
  });

  describe("given a summed cost coming back", () => {
    describe("when the row is presented", () => {
      it("normalises the float drift a sum carries", async () => {
        const { repository } = repositoryOver([
          { VirtualKeyId: "vk-1", SpentUSD: "0.000044999999999999996", Requests: "3" },
        ]);

        const [spend] = await repository.spendByVirtualKey({
          tenantIds: ["tenant-1"],
          virtualKeyIds: ["vk-1"],
          window: WINDOW,
        });

        expect(spend?.spentUsd).not.toContain("999999");
        expect(spend?.requests).toBe(3);
      });
    });

    describe("when the request count is not a number", () => {
      it("reads as zero rather than NaN", async () => {
        const { repository } = repositoryOver([
          { VirtualKeyId: "vk-1", SpentUSD: "0", Requests: "not a number" },
        ]);

        const [spend] = await repository.spendByVirtualKey({
          tenantIds: ["tenant-1"],
          virtualKeyIds: ["vk-1"],
          window: WINDOW,
        });

        expect(spend?.requests).toBe(0);
      });
    });
  });
});
