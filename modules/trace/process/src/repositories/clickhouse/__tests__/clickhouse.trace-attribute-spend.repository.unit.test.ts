/** Main's gateway virtual-key spend reads, ported to the table's owner one tenant at a time. */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceAttributeSpendRepository } from "../../memory/memory.trace-attribute-spend.repository.ts";
import { ClickHouseTraceAttributeSpendRepository } from "../clickhouse.trace-attribute-spend.repository.ts";

const WINDOW = { startMs: 1_788_220_800_000, endMs: 1_789_000_000_000 };
const KEY = "langwatch.virtual_key_id";

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
  });
  return { queries, repository: ClickHouseTraceAttributeSpendRepository.create(clickhouse) };
}

describe("ClickHouseTraceAttributeSpendRepository", () => {
  describe("when spend is read per attribute value", () => {
    it("scopes to the tenant first, bounds the partition key and dedupes by UpdatedAt", async () => {
      const { queries, repository } = createRepository([]);

      await repository.findSpendByAttributeValue({
        tenantId: "project-1",
        attributeKey: KEY,
        values: ["vk-1"],
        window: WINDOW,
      });

      expect(queries[0]?.tenantId).toBe("project-1");
      expect(queries[0]?.sql).toMatch(/WHERE TenantId = \{tenantId:String\}\s+AND OccurredAt >=/);
      expect(queries[0]?.sql).toContain("argMax(coalesce(TotalCost, 0), UpdatedAt)");
      expect(queries[0]?.params).toEqual({
        tenantId: "project-1",
        attributeKey: KEY,
        fromMs: WINDOW.startMs,
        toMs: WINDOW.endMs,
        values: ["vk-1"],
      });
    });

    it("answers nothing without querying when no values are asked for", async () => {
      const { queries, repository } = createRepository([]);

      await expect(
        repository.findSpendByAttributeValue({
          tenantId: "project-1",
          attributeKey: KEY,
          values: [],
          window: WINDOW,
        }),
      ).resolves.toEqual([]);
      expect(queries).toHaveLength(0);
    });
  });

  describe("when usage buckets are read for any value", () => {
    it("matches every non-empty value and maps counts to numbers", async () => {
      const { queries, repository } = createRepository([
        {
          Value: "vk-1",
          Model: "gpt-5",
          Day: "2026-09-01",
          TotalUsd: "1.5",
          Requests: "3",
          BlockedRequests: "1",
        },
      ]);

      await expect(
        repository.findAttributeUsageBuckets({
          tenantId: "project-1",
          attributeKey: KEY,
          window: WINDOW,
        }),
      ).resolves.toEqual([
        {
          value: "vk-1",
          model: "gpt-5",
          day: "2026-09-01",
          totalUsd: "1.5",
          requests: 3,
          blockedRequests: 1,
        },
      ]);
      expect(queries[0]?.sql).toContain("Attributes[{attributeKey:String}] != ''");
      expect(queries[0]?.params).not.toHaveProperty("values");
    });
  });

  describe("when recent traces are read for one model", () => {
    it("filters the winning version's first model and orders newest first under the limit", async () => {
      const { queries, repository } = createRepository([]);

      await repository.findAttributedTraces({
        tenantId: "project-1",
        attributeKey: KEY,
        window: WINDOW,
        values: ["vk-1"],
        model: "gpt-5",
        limit: 20,
      });

      expect(queries[0]?.sql).toContain("arrayElement(TraceModels, 1)) = {model:String}");
      expect(queries[0]?.sql).toContain("ORDER BY OccurredAtMs DESC");
      expect(queries[0]?.params).toMatchObject({ model: "gpt-5", limit: 20 });
    });
  });
});

describe("MemoryTraceAttributeSpendRepository", () => {
  describe("when traces carry the attribute in two tenants", () => {
    it("reads one tenant's traces, grouped per value, model and UTC day", async () => {
      const repository = MemoryTraceAttributeSpendRepository.create();
      const base = { occurredAtMs: WINDOW.startMs, models: ["gpt-5"] };
      repository.record({
        ...base,
        tenantId: "p1",
        traceId: "t1",
        attributes: { [KEY]: "vk-1" },
        costUsd: 1,
      });
      repository.record({
        ...base,
        tenantId: "p1",
        traceId: "t2",
        attributes: { [KEY]: "vk-1" },
        costUsd: 2,
        blockedByGuardrail: true,
      });
      repository.record({ ...base, tenantId: "p1", traceId: "t3", attributes: {}, costUsd: 4 });
      repository.record({
        ...base,
        tenantId: "p2",
        traceId: "t4",
        attributes: { [KEY]: "vk-1" },
        costUsd: 8,
      });

      await expect(
        repository.findAttributeUsageBuckets({ tenantId: "p1", attributeKey: KEY, window: WINDOW }),
      ).resolves.toEqual([
        {
          value: "vk-1",
          model: "gpt-5",
          day: "2026-09-01",
          totalUsd: "3",
          requests: 2,
          blockedRequests: 1,
        },
      ]);
      await expect(
        repository.findSpendByAttributeValue({
          tenantId: "p2",
          attributeKey: KEY,
          values: ["vk-1"],
          window: WINDOW,
        }),
      ).resolves.toEqual([{ value: "vk-1", spentUsd: "8", requests: 1 }]);
    });
  });
});
