/** Main's gateway virtual-key spend reads, ported to the table's owner. */
import type { ClickHouseQueryClient, QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceAttributeSpendRepository } from "../../memory/memory.trace-attribute-spend.repository.ts";
import { ClickHouseTraceAttributeSpendRepository } from "../clickhouse.trace-attribute-spend.repository.ts";

const WINDOW = { startMs: 1_788_220_800_000, endMs: 1_789_000_000_000 };
const KEY = "langwatch.virtual_key_id";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const statements: ReadRequest["statement"][] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
    async read({ statement }: ReadRequest) {
      statements.push(statement);
      return { rows };
    },
  });
  return {
    queries,
    statements,
    repository: ClickHouseTraceAttributeSpendRepository.create(clickhouse),
  };
}

describe("ClickHouseTraceAttributeSpendRepository", () => {
  describe("when spend is read per attribute value", () => {
    it("scopes to the tenant first, bounds the partition key and dedupes by UpdatedAt", async () => {
      const { statements, repository } = createRepository([]);

      await repository.findSpendByAttributeValue({
        tenantId: "project-1",
        attributeKey: KEY,
        values: ["vk-1"],
        window: WINDOW,
      });

      expect(statements[0]).toMatchObject({
        kind: "tenant",
        identity: "reader",
        tenantIds: undefined,
      });
      expect(statements[0]?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statements[0]?.sql).toMatch(
        /WHERE TenantId = \{tenantId:String\} AND \(\(OccurredAt >= fromUnixTimestamp64Milli/,
      );
      expect(statements[0]?.sql).toMatch(
        /argMax\(ifNull\(TotalCost, \{v\d+:Float64\}\), UpdatedAt\)/,
      );
      expect(Object.values(statements[0]?.params ?? {})).toEqual(
        expect.arrayContaining(["project-1", KEY, WINDOW.startMs, WINDOW.endMs, ["vk-1"]]),
      );
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
          tenantIds: ["project-1"],
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

  describe("when usage buckets are read across an organization's projects", () => {
    it("asks once over the declared tenant set, deduping each trace within its tenant", async () => {
      const { queries, repository } = createRepository([]);

      await repository.findAttributeUsageBuckets({
        tenantIds: ["project-1", "project-2"],
        attributeKey: KEY,
        window: WINDOW,
        values: ["vk-1"],
      });

      expect(queries).toHaveLength(1);
      expect(queries[0]).toMatchObject({
        tenantId: "project-1",
        tenantIds: ["project-1", "project-2"],
      });
      expect(queries[0]?.sql).toContain("TenantId IN ({tenantIds:Array(String)})");
      expect(queries[0]?.sql).toContain("GROUP BY TenantId, TraceId");
      expect(queries[0]?.params).toMatchObject({ tenantIds: ["project-1", "project-2"] });
      // Under the client's 30 s request deadline, so ClickHouse ends a slow read first.
      expect(Number(queries[0]?.settings?.max_execution_time)).toBeLessThan(30);
    });

    it("answers nothing without querying when the organization has no projects", async () => {
      const { queries, repository } = createRepository([]);

      await expect(
        repository.findAttributedTraces({
          tenantIds: [],
          attributeKey: KEY,
          window: WINDOW,
          limit: 20,
        }),
      ).resolves.toEqual([]);
      expect(queries).toHaveLength(0);
    });
  });

  describe("when recent traces are read for one model", () => {
    it("filters the winning version's first model and orders newest first under the limit", async () => {
      const { statements, repository } = createRepository([]);

      await repository.findAttributedTraces({
        tenantIds: ["project-1", "project-2"],
        attributeKey: KEY,
        window: WINDOW,
        values: ["vk-1"],
        model: "gpt-5",
        limit: 20,
      });

      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatchObject({
        kind: "tenant",
        tenantIds: ["project-1", "project-2"],
      });
      expect(statements[0]?.settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project-1,project-2",
      });
      expect(statements[0]?.sql).toContain("GROUP BY TenantId, TraceId");
      expect(statements[0]?.sql).toMatch(
        /arrayElement\(TraceModels, \{v\d+:Int64\}\), \{v\d+:String\}\) = \{v\d+:String\}/,
      );
      expect(statements[0]?.sql).toMatch(
        /ORDER BY OccurredAtMs DESC LIMIT 20 SETTINGS .*max_execution_time = 28/,
      );
      expect(Object.values(statements[0]?.params ?? {})).toContain("gpt-5");
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
        repository.findAttributeUsageBuckets({
          tenantIds: ["p1"],
          attributeKey: KEY,
          window: WINDOW,
        }),
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
