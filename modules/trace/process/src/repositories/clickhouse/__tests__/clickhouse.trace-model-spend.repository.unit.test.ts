/**
 * Main's personal-usage model breakdown, ported to the table's owner: `TenantId` first, the window
 * on the `OccurredAt` partition key, deduped by `argMax(..., UpdatedAt)`, most spent first.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceModelSpendRepository } from "../../memory/memory.trace-model-spend.repository.ts";
import { ClickHouseTraceModelSpendRepository } from "../clickhouse.trace-model-spend.repository.ts";

const WINDOW = { startMs: 1_788_220_800_000, endMs: 1_789_000_000_000 };

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function createRepository(rows: unknown[]) {
  const queries: ReadRequest["statement"][] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async read({ statement }: ReadRequest) {
      queries.push(statement);
      return { rows };
    },
  });
  return { queries, repository: ClickHouseTraceModelSpendRepository.create(clickhouse) };
}

/** One tenant's reader read: its predicate first, its setting, the window on `OccurredAt`. */
function expectTenantWindow(statement: ReadRequest["statement"] | undefined) {
  expect(statement?.kind).toBe("tenant");
  expect(statement?.identity).toBe("reader");
  expect(statement).toMatchObject({ tenantIds: undefined });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
  expect(statement?.sql).toMatch(
    /WHERE TenantId = \{tenantId:String\} AND \(?\(?OccurredAt >= fromUnixTimestamp64Milli/,
  );
  expect(statement?.sql).toContain("SETTINGS max_bytes_before_external_group_by = 500000000");
  expect(Object.values(statement?.params ?? {})).toEqual(
    expect.arrayContaining(["project-1", WINDOW.startMs, WINDOW.endMs]),
  );
}

describe("ClickHouseTraceModelSpendRepository", () => {
  describe("when a project's spend is read by model", () => {
    it("scopes to the tenant first and bounds the window on the partition key", async () => {
      const { queries, repository } = createRepository([]);

      await repository.findModelSpend({ tenantId: "project-1", window: WINDOW, limit: 3 });

      expectTenantWindow(queries[0]);
      expect(queries[0]?.sql).toContain("argMax(Models, UpdatedAt)");
      expect(queries[0]?.sql).toContain("ORDER BY SpentUsd DESC LIMIT 3");
    });

    it("answers each model's spend, billed spend and requests as numbers", async () => {
      const { repository } = createRepository([
        { Model: "gpt-5", SpentUsd: "12.5", BilledUsd: "10", Requests: "4" },
      ]);

      await expect(
        repository.findModelSpend({ tenantId: "project-1", window: WINDOW, limit: 3 }),
      ).resolves.toEqual([{ label: "gpt-5", spentUsd: 12.5, billedUsd: 10, requests: 4 }]);
    });
  });
});

describe("MemoryTraceModelSpendRepository", () => {
  describe("when traces used several models", () => {
    it("counts each trace's whole cost toward every model it used, most spent first", async () => {
      const repository = MemoryTraceModelSpendRepository.create();
      const base = { tenantId: "project-1", occurredAtMs: WINDOW.startMs, nonBilledUsd: 0 };
      repository.record({ ...base, models: ["gpt-5", "claude"], spentUsd: 2 });
      repository.record({ ...base, models: ["claude"], spentUsd: 3 });
      repository.record({ ...base, tenantId: "project-2", models: ["gpt-5"], spentUsd: 9 });
      repository.record({ ...base, occurredAtMs: WINDOW.endMs, models: ["gpt-5"], spentUsd: 9 });

      await expect(
        repository.findModelSpend({ tenantId: "project-1", window: WINDOW, limit: 1 }),
      ).resolves.toEqual([{ label: "claude", spentUsd: 5, billedUsd: 5, requests: 2 }]);
    });
  });
});

describe("ClickHouseTraceModelSpendRepository personal-usage reads", () => {
  describe("when a project's spend summary is read", () => {
    it("scopes to the tenant first, bounds the partition key and dedupes by UpdatedAt", async () => {
      const { queries, repository } = createRepository([
        {
          TotalSpentUsd: "4",
          BilledUsd: "3",
          RequestCount: "2",
          PromptTokenSum: "10",
          CompletionTokenSum: "20",
        },
      ]);

      await expect(
        repository.getSpendSummary({ tenantId: "project-1", window: WINDOW }),
      ).resolves.toEqual({
        totalCost: 4,
        billedCost: 3,
        requestCount: 2,
        promptTokens: 10,
        completionTokens: 20,
      });
      expectTenantWindow(queries[0]);
      expect(queries[0]?.sql).toContain("argMax(TotalPromptTokenCount, UpdatedAt)");
    });

    it("answers zeros when the tenant has no traces", async () => {
      const { repository } = createRepository([]);

      await expect(
        repository.getSpendSummary({ tenantId: "project-1", window: WINDOW }),
      ).resolves.toEqual({
        totalCost: 0,
        billedCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
    });
  });

  describe("when top models and daily spend are read", () => {
    it("answers models by request count and days in order", async () => {
      const top = createRepository([{ Model: "gpt-5", Requests: "3" }]);
      const daily = createRepository([
        { Day: "2026-08-01", SpentUsd: "4", BilledUsd: "3", Requests: "4" },
      ]);

      await expect(
        top.repository.findTopModelsByRequests({ tenantId: "project-1", window: WINDOW, limit: 1 }),
      ).resolves.toEqual([{ model: "gpt-5", requests: 3 }]);
      await expect(
        daily.repository.findDailySpend({ tenantId: "project-1", window: WINDOW }),
      ).resolves.toEqual([{ day: "2026-08-01", spentUsd: 4, billedUsd: 3, requests: 4 }]);
      expectTenantWindow(top.queries[0]);
      expect(top.queries[0]?.sql).toContain("ORDER BY Requests DESC LIMIT 1");
      expectTenantWindow(daily.queries[0]);
      expect(daily.queries[0]?.sql).toContain("ORDER BY Day ASC");
    });
  });
});

describe("MemoryTraceModelSpendRepository personal-usage reads", () => {
  it("sums, ranks and buckets the tenant's traces in the window", async () => {
    const repository = MemoryTraceModelSpendRepository.create();
    const base = { tenantId: "project-1", occurredAtMs: WINDOW.startMs, nonBilledUsd: 1 };
    repository.record({ ...base, models: ["claude"], spentUsd: 2, promptTokens: 5 });
    repository.record({ ...base, models: ["claude", "gpt-5"], spentUsd: 3, completionTokens: 7 });
    repository.record({ ...base, tenantId: "project-2", models: ["gpt-5"], spentUsd: 9 });

    await expect(
      repository.getSpendSummary({ tenantId: "project-1", window: WINDOW }),
    ).resolves.toEqual({
      totalCost: 5,
      billedCost: 3,
      requestCount: 2,
      promptTokens: 5,
      completionTokens: 7,
    });
    await expect(
      repository.findTopModelsByRequests({ tenantId: "project-1", window: WINDOW, limit: 1 }),
    ).resolves.toEqual([{ model: "claude", requests: 2 }]);
    await expect(
      repository.findDailySpend({ tenantId: "project-1", window: WINDOW }),
    ).resolves.toEqual([{ day: "2026-09-01", spentUsd: 5, billedUsd: 3, requests: 2 }]);
  });
});
