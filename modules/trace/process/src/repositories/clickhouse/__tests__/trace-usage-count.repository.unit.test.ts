import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../memory/memory.trace-usage-count.repository.ts";
import { TraceUsageCountClickHouseRepository } from "../trace-usage-count.repository.ts";

const ORIGIN = { key: "langwatch.origin.kind", value: "ingestion_source" };

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
  });
  return { queries, repository: TraceUsageCountClickHouseRepository.create(clickhouse) };
}

describe("TraceUsageCountClickHouseRepository", () => {
  describe("when the last day's traces are counted", () => {
    it("counts distinct traces on the tenant over the trailing 24 hours", async () => {
      const { queries, repository } = createRepository([{ total: "12" }]);

      await expect(repository.countTracesInLastDay({ tenantId: "project-1" })).resolves.toBe(12);
      expect(queries[0]?.tenantId).toBe("project-1");
      expect(queries[0]?.sql).toMatch(/WHERE TenantId = \{tenantId:String\}\s+AND OccurredAt >=/);
      expect(queries[0]?.sql).toContain("count(DISTINCT TraceId)");
    });
  });

  describe("when traces carrying an attribute are probed", () => {
    it("answers whether any row matched", async () => {
      const hit = createRepository([{ hit: 1 }]);
      const miss = createRepository([]);
      const input = { tenantId: "project-1", sinceMs: 1_000, attribute: ORIGIN };

      await expect(hit.repository.hasTraceWithAttribute(input)).resolves.toBe(true);
      await expect(miss.repository.hasTraceWithAttribute(input)).resolves.toBe(false);
      expect(hit.queries[0]?.params).toEqual({
        tenantId: "project-1",
        since: 1_000,
        attributeKey: ORIGIN.key,
        attributeValue: ORIGIN.value,
      });
    });

    it("counts matching rows per grouping attribute value", async () => {
      const { queries, repository } = createRepository([{ value: "source-1", count: "7" }]);

      await expect(
        repository.findTraceCountsByAttribute({
          tenantId: "project-1",
          sinceMs: 1_000,
          attribute: ORIGIN,
          groupByKey: "langwatch.ingestion_source.id",
        }),
      ).resolves.toEqual([{ value: "source-1", count: 7 }]);
      expect(queries[0]?.sql).toContain("ORDER BY count DESC");
    });
  });
});

describe("MemoryTraceUsageCountRepository", () => {
  it("probes and groups the tenant's matching traces since the cutoff", async () => {
    const repository = MemoryTraceUsageCountRepository.create();
    const base = { tenantId: "project-1", createdAt: "", occurredAtMs: 2_000 };
    repository.record({
      ...base,
      traceId: "a",
      attributes: { [ORIGIN.key]: ORIGIN.value, s: "1" },
    });
    repository.record({
      ...base,
      traceId: "b",
      attributes: { [ORIGIN.key]: ORIGIN.value, s: "1" },
    });
    repository.record({
      ...base,
      traceId: "c",
      attributes: { [ORIGIN.key]: ORIGIN.value, s: "2" },
    });
    repository.record({
      ...base,
      traceId: "d",
      occurredAtMs: 500,
      attributes: { [ORIGIN.key]: ORIGIN.value },
    });
    repository.record({
      ...base,
      traceId: "e",
      tenantId: "project-2",
      attributes: { [ORIGIN.key]: ORIGIN.value },
    });

    const input = { tenantId: "project-1", sinceMs: 1_000, attribute: ORIGIN };
    await expect(repository.hasTraceWithAttribute(input)).resolves.toBe(true);
    await expect(
      repository.findTraceCountsByAttribute({ ...input, groupByKey: "s" }),
    ).resolves.toEqual([
      { value: "1", count: 2 },
      { value: "2", count: 1 },
    ]);
    await expect(
      repository.hasTraceWithAttribute({ ...input, tenantId: "project-3" }),
    ).resolves.toBe(false);
  });
});
