/**
 * Main's governance personal-usage ledger reads, ported to the ledger's owner: `TenantId` first,
 * the window on the `OccurredAt` partition key, one row per gateway request before any sum.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it, vi } from "vitest";

import { MemoryGatewayPrincipalSpendRepository } from "../../memory/memory.gateway-principal-spend.repository.ts";
import { ClickHouseGatewayPrincipalSpendRepository } from "../clickhouse.gateway-principal-spend.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";

const WINDOW = {
  startMs: Date.parse("2026-08-01T00:00:00.000Z"),
  endMs: Date.parse("2026-08-03T00:00:00.000Z"),
};
const INPUT = { tenantId: "governance-project", userId: "user-1", window: WINDOW };

function repositoryOver(...answers: unknown[][]) {
  const statements: ReaderReadStatement[] = [];
  const resolvedFor: string[] = [];
  const read = vi.fn().mockImplementation(async ({ statement }) => {
    statements.push(statement);
    return { rows: answers[statements.length - 1] ?? [] };
  });
  const client: GatewayClickHouseClient = {
    read,
    insert: async () => undefined,
  };
  const repository = ClickHouseGatewayPrincipalSpendRepository.create(async (tenantId) => {
    resolvedFor.push(tenantId);
    return client;
  });
  return { statements, resolvedFor, repository };
}

function expectPrincipalScope(statement: ReaderReadStatement | undefined) {
  expect(statement).toMatchObject({
    identity: "reader",
    kind: "tenant",
    tenantId: "governance-project",
  });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "governance-project" });
  expect(statement?.sql).toContain("SETTINGS max_bytes_before_external_group_by = 500000000");
  expect(statement?.sql).toContain("TenantId = {tenantId:String}");
  expect(statement?.sql).toContain("GROUP BY GatewayRequestId) AS requests");
  expect(Object.values(statement?.params ?? {})).toEqual(
    expect.arrayContaining(["principal", "user-1", "success", WINDOW.startMs, WINDOW.endMs]),
  );
}

describe("ClickHouseGatewayPrincipalSpendRepository", () => {
  describe("when a user's principal summary is read", () => {
    it("collapses to one row per request on the tenant, then names the top model", async () => {
      const { statements, resolvedFor, repository } = repositoryOver(
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
      expect(statements).toHaveLength(2);
      statements.forEach(expectPrincipalScope);
      expect(statements[1]?.sql).toContain("LIMIT 1");
    });

    it("answers zeros and skips the model read when the user made no requests", async () => {
      const { statements, repository } = repositoryOver([
        { TotalNanoCost: "0", RequestCount: "0" },
      ]);

      await expect(repository.getSummary(INPUT)).resolves.toEqual({
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      });
      expect(statements).toHaveLength(1);
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
      expectPrincipalScope(daily.statements[0]);
      expectPrincipalScope(models.statements[0]);
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
