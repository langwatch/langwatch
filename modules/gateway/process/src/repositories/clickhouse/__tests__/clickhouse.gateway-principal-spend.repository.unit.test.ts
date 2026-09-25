/**
 * Main's governance personal-usage ledger reads, ported to the ledger's owner: `TenantId` first,
 * the window on the `OccurredAt` partition key, one row per gateway request before any sum.
 */
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../../../app/gateway.members.ts";
import { MemoryGatewayPrincipalSpendRepository } from "../../memory/memory.gateway-principal-spend.repository.ts";
import { ClickHouseGatewayPrincipalSpendRepository } from "../clickhouse.gateway-principal-spend.repository.ts";

const WINDOW = {
  startMs: Date.parse("2026-08-01T00:00:00.000Z"),
  endMs: Date.parse("2026-08-03T00:00:00.000Z"),
};
const INPUT = { tenantId: "governance-project", userId: "user-1", window: WINDOW };

function repositoryOver(...answers: unknown[][]) {
  const queries: { query: string; query_params?: Record<string, unknown> }[] = [];
  const resolvedFor: string[] = [];
  const client: GatewayClickHouseClient = {
    query: async (request) => {
      queries.push(request);
      const rows = answers[queries.length - 1] ?? [];
      return { json: async () => JSON.parse(JSON.stringify(rows)) };
    },
    insert: async () => undefined,
  };
  const repository = ClickHouseGatewayPrincipalSpendRepository.create(async (tenantId) => {
    resolvedFor.push(tenantId);
    return client;
  });
  return { queries, resolvedFor, repository };
}

describe("ClickHouseGatewayPrincipalSpendRepository", () => {
  describe("when a user's principal summary is read", () => {
    it("collapses to one row per request on the tenant, then names the top model", async () => {
      const { queries, resolvedFor, repository } = repositoryOver(
        [
          {
            TotalNanoCost: "2000000000",
            RequestCount: "2",
            PromptTokens: "5",
            CompletionTokens: "7",
          },
        ],
        [{ Name: "ledger-model", Requests: "2" }],
      );

      await expect(repository.getSummary(INPUT)).resolves.toEqual({
        totalCost: 2,
        requestCount: 2,
        promptTokens: 5,
        completionTokens: 7,
        topModel: { name: "ledger-model", requests: 2 },
      });
      expect(resolvedFor).toEqual(["governance-project"]);
      expect(queries[0]?.query).toMatch(
        /WHERE TenantId = \{tenantId:String\}\s+AND Scope = 'principal'/,
      );
      expect(queries[0]?.query).toContain("GROUP BY GatewayRequestId");
      expect(queries[0]?.query_params).toEqual({
        tenantId: "governance-project",
        userId: "user-1",
        fromMs: WINDOW.startMs,
        toMs: WINDOW.endMs,
      });
    });

    it("answers zeros and skips the model read when the user made no requests", async () => {
      const { queries, repository } = repositoryOver([{ TotalNanoCost: "0", RequestCount: "0" }]);

      await expect(repository.getSummary(INPUT)).resolves.toEqual({
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      });
      expect(queries).toHaveLength(1);
    });
  });

  describe("when daily and per-model spend are read", () => {
    it("answers nano sums as fully billed USD", async () => {
      const daily = repositoryOver([
        { Day: "2026-08-01", SpentNanoUsd: "1500000000", Requests: "3" },
      ]);
      const models = repositoryOver([{ Label: "m", SpentNanoUsd: "500000000", Requests: "1" }]);

      await expect(daily.repository.findDailySpend(INPUT)).resolves.toEqual([
        { day: "2026-08-01", spentUsd: 1.5, billedUsd: 1.5, requests: 3 },
      ]);
      await expect(models.repository.findModelSpend(INPUT)).resolves.toEqual([
        { label: "m", spentUsd: 0.5, billedUsd: 0.5, requests: 1 },
      ]);
    });
  });
});

describe("MemoryGatewayPrincipalSpendRepository", () => {
  it("sums the user's requests in the window by day and model", async () => {
    const repository = MemoryGatewayPrincipalSpendRepository.create();
    const base = {
      tenantId: "governance-project",
      userId: "user-1",
      occurredAtMs: WINDOW.startMs,
      tokensInput: 1,
      tokensOutput: 2,
    };
    repository.record({ ...base, amountUsd: 1, model: "a" });
    repository.record({ ...base, amountUsd: 2, model: "b" });
    repository.record({ ...base, amountUsd: 3, model: "b", userId: "user-2" });
    repository.record({ ...base, amountUsd: 4, model: "b", occurredAtMs: WINDOW.endMs });

    await expect(repository.getSummary(INPUT)).resolves.toMatchObject({
      totalCost: 3,
      requestCount: 2,
      promptTokens: 2,
      completionTokens: 4,
    });
    await expect(repository.findDailySpend(INPUT)).resolves.toEqual([
      { day: "2026-08-01", spentUsd: 3, billedUsd: 3, requests: 2 },
    ]);
    await expect(repository.findModelSpend(INPUT)).resolves.toEqual([
      { label: "b", spentUsd: 2, billedUsd: 2, requests: 1 },
      { label: "a", spentUsd: 1, billedUsd: 1, requests: 1 },
    ]);
  });
});
