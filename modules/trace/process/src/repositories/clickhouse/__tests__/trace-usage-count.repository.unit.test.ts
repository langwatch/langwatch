/** Spec: modules/trace/specs/trace-first-seen.feature */
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

describe("TraceUsageCountClickHouseRepository traces first seen", () => {
  /** @scenario "The upgrade counts a trace in the month it was first seen" */
  it("counts traces by their earliest summary write inside the window", async () => {
    const { queries, repository } = createRepository([{ total: "40" }]);
    const fromMs = Date.UTC(2026, 9, 1);
    const toMs = Date.UTC(2026, 9, 8, 15);

    await expect(
      repository.countTracesFirstSeen({ tenantId: "project-1", fromMs, toMs }),
    ).resolves.toBe(40);
    const sql = queries[0]?.sql.replace(/\s+/g, " ");
    expect(queries[0]?.tenantId).toBe("project-1");
    expect(sql).toContain("SELECT TraceId, min(CreatedAt) AS FirstSeenAt FROM trace_summaries");
    expect(sql).toContain("WHERE TenantId = {tenantId:String} AND OccurredAt >=");
    expect(sql).toContain("WHERE FirstSeenAt >= fromUnixTimestamp64Milli({from:Int64})");
    expect(queries[0]?.params).toMatchObject({ from: fromMs, to: toMs });
  });
});

describe("TraceUsageCountClickHouseRepository count moment", () => {
  /** @scenario "The upgrade stores the moment it counts up to before it counts" */
  it("reads the deployment's earliest stored moment, or nothing", async () => {
    const stored = createRepository([{ countedUntil: "1791460800000" }]);
    const none = createRepository([]);

    await expect(stored.repository.findCountMoment()).resolves.toEqual([1_791_460_800_000]);
    await expect(none.repository.findCountMoment()).resolves.toEqual([]);
    expect(stored.queries[0]?.sql).toContain("min(CountedUntilMs)");
    expect(stored.queries[0]?.table).toBe("trace_count_moment");
  });
});

describe("MemoryTraceUsageCountRepository", () => {
  /** @scenario "The upgrade counts a trace in the month it was first seen" */
  it("counts a trace once, in the window holding its earliest summary write", async () => {
    const repository = MemoryTraceUsageCountRepository.create();
    const at = (traceId: string, createdAt: string) =>
      repository.record({ tenantId: "project-1", traceId, createdAt });
    at("last-month", "2026-09-30 23:00:00.000");
    at("last-month", "2026-10-02 00:00:00.000");
    at("this-month", "2026-10-02 00:00:00.000");
    at("this-month", "2026-10-03 00:00:00.000");
    at("after-cut", "2026-10-08 15:00:00.000");

    await expect(
      repository.countTracesFirstSeen({
        tenantId: "project-1",
        fromMs: Date.UTC(2026, 9, 1),
        toMs: Date.UTC(2026, 9, 8, 15),
      }),
    ).resolves.toBe(1);
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
