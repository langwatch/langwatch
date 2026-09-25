/**
 * Main's personal-usage model breakdown, ported to the table's owner: `TenantId` first, the window
 * on the `OccurredAt` partition key, deduped by `argMax(..., UpdatedAt)`, most spent first.
 */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceModelSpendRepository } from "../../memory/memory.trace-model-spend.repository.ts";
import { ClickHouseTraceModelSpendRepository } from "../clickhouse.trace-model-spend.repository.ts";

const WINDOW = { startMs: 1_788_220_800_000, endMs: 1_789_000_000_000 };

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
  });
  return { queries, repository: ClickHouseTraceModelSpendRepository.create(clickhouse) };
}

describe("ClickHouseTraceModelSpendRepository", () => {
  describe("when a project's spend is read by model", () => {
    it("scopes to the tenant first and bounds the window on the partition key", async () => {
      const { queries, repository } = createRepository([]);

      await repository.findModelSpend({ tenantId: "project-1", window: WINDOW, limit: 3 });

      expect(queries[0]?.tenantId).toBe("project-1");
      expect(queries[0]?.sql).toMatch(/WHERE TenantId = \{tenantId:String\}\s+AND OccurredAt >=/);
      expect(queries[0]?.sql).toContain("argMax(Models, UpdatedAt)");
      expect(queries[0]?.sql).toContain("ORDER BY SpentUsd DESC");
      expect(queries[0]?.params).toEqual({
        tenantId: "project-1",
        fromMs: WINDOW.startMs,
        toMs: WINDOW.endMs,
        lim: 3,
      });
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
