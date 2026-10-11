/** Spec: modules/trace/specs/trace-month-trace-ids.feature */
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

describe("TraceUsageCountClickHouseRepository trace ids first seen", () => {
  /** @scenario "The upgrade sends each project's trace ids for the month in pages" */
  it("pages trace ids by their earliest summary write inside the window, in id order", async () => {
    const { queries, repository } = createRepository([{ traceId: "t1" }, { traceId: "t2" }]);
    const fromMs = Date.UTC(2026, 9, 1);
    const toMs = Date.UTC(2026, 9, 8, 15);

    await expect(
      repository.findTraceIdsFirstSeen({
        tenantId: "project-1",
        fromMs,
        toMs,
        afterTraceId: "t0",
        limit: 5_000,
      }),
    ).resolves.toEqual(["t1", "t2"]);
    const sql = queries[0]?.sql.replace(/\s+/g, " ");
    expect(queries[0]?.tenantId).toBe("project-1");
    expect(sql).toContain(
      "WHERE TenantId = {tenantId:String} AND TraceId > {afterTraceId:String} AND OccurredAt >=",
    );
    expect(sql).toContain("HAVING min(CreatedAt) >= fromUnixTimestamp64Milli({from:Int64})");
    expect(sql).toContain("ORDER BY TraceId LIMIT {limit:UInt32}");
    expect(queries[0]?.params).toMatchObject({
      afterTraceId: "t0",
      from: fromMs,
      to: toMs,
      limit: 5_000,
    });
  });
});

describe("MemoryTraceUsageCountRepository", () => {
  /** @scenario "The upgrade sends each project's trace ids for the month in pages" */
  it("lists a trace once, in the window holding its earliest summary write", async () => {
    const repository = MemoryTraceUsageCountRepository.create();
    const at = (traceId: string, createdAt: string) =>
      repository.record({ tenantId: "project-1", traceId, createdAt });
    at("last-month", "2026-09-30 23:00:00.000");
    at("last-month", "2026-10-02 00:00:00.000");
    at("this-month-b", "2026-10-02 00:00:00.000");
    at("this-month-b", "2026-10-03 00:00:00.000");
    at("this-month-a", "2026-10-04 00:00:00.000");
    at("after-start", "2026-10-08 15:00:00.000");
    const page = (afterTraceId: string) =>
      repository.findTraceIdsFirstSeen({
        tenantId: "project-1",
        fromMs: Date.UTC(2026, 9, 1),
        toMs: Date.UTC(2026, 9, 8, 15),
        afterTraceId,
        limit: 1,
      });

    await expect(page("")).resolves.toEqual(["this-month-a"]);
    await expect(page("this-month-a")).resolves.toEqual(["this-month-b"]);
    await expect(page("this-month-b")).resolves.toEqual([]);
  });

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
