/** Spec: modules/trace/specs/trace-month-trace-ids.feature */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../memory/memory.trace-usage-count.repository.ts";
import { TraceUsageCountClickHouseRepository } from "../trace-usage-count.repository.ts";

const ORIGIN = { key: "langwatch.origin.kind", value: "ingestion_source" };
const TENANT_SETTING = "SQL_langwatch_tenant_ids";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function createRepository(rows: unknown[]) {
  const statements: ReadRequest["statement"][] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async read({ statement }: ReadRequest) {
      statements.push(statement);
      return { rows };
    },
  });
  return { statements, repository: TraceUsageCountClickHouseRepository.create(clickhouse) };
}

/** Every read is one tenant's: the reader identity, its predicate and its tenant setting. */
function expectSingleTenant(statement: ReadRequest["statement"] | undefined) {
  expect(statement?.kind).toBe("tenant");
  expect(statement?.identity).toBe("reader");
  expect(statement).toMatchObject({ tenantIds: undefined });
  expect(statement?.settings).toMatchObject({ [TENANT_SETTING]: "project-1" });
  expect(statement?.sql).toMatch(/WHERE TenantId = \{tenantId:String\}/);
  expect(Object.values(statement?.params ?? {})).toContain("project-1");
}

describe("TraceUsageCountClickHouseRepository", () => {
  describe("when the last day's traces are counted", () => {
    it("counts distinct traces on the tenant over the trailing 24 hours", async () => {
      const { statements, repository } = createRepository([{ total: "12" }]);

      await expect(repository.countTracesInLastDay({ tenantId: "project-1" })).resolves.toBe(12);
      expectSingleTenant(statements[0]);
      expect(statements[0]?.sql).toMatch(/AND OccurredAt >= fromUnixTimestamp64Milli\(/);
      expect(statements[0]?.sql).toMatch(/countDistinct\(TraceId\)/);
    });
  });

  describe("when traces carrying an attribute are probed", () => {
    it("answers whether any row matched", async () => {
      const hit = createRepository([{ traceId: "t1" }]);
      const miss = createRepository([]);
      const input = { tenantId: "project-1", sinceMs: 1_000, attribute: ORIGIN };

      await expect(hit.repository.hasTraceWithAttribute(input)).resolves.toBe(true);
      await expect(miss.repository.hasTraceWithAttribute(input)).resolves.toBe(false);
      expectSingleTenant(hit.statements[0]);
      expect(hit.statements[0]?.sql).toMatch(/LIMIT 1$/);
      expect(Object.values(hit.statements[0]?.params ?? {})).toEqual(
        expect.arrayContaining(["project-1", 1_000, ORIGIN.key, ORIGIN.value]),
      );
    });

    it("counts matching rows per grouping attribute value", async () => {
      const { statements, repository } = createRepository([{ value: "source-1", count: "7" }]);

      await expect(
        repository.findTraceCountsByAttribute({
          tenantId: "project-1",
          sinceMs: 1_000,
          attribute: ORIGIN,
          groupByKey: "langwatch.ingestion_source.id",
        }),
      ).resolves.toEqual([{ value: "source-1", count: 7 }]);
      expectSingleTenant(statements[0]);
      expect(statements[0]?.sql).toContain("ORDER BY count DESC");
      expect(Object.values(statements[0]?.params ?? {})).toContain("langwatch.ingestion_source.id");
    });
  });
});

describe("TraceUsageCountClickHouseRepository trace ids first seen", () => {
  /** @scenario "The upgrade sends each project's trace ids for the month in pages" */
  it("pages trace ids by their earliest summary write inside the window, in id order", async () => {
    const { statements, repository } = createRepository([{ traceId: "t1" }, { traceId: "t2" }]);
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
    const sql = statements[0]?.sql ?? "";
    expectSingleTenant(statements[0]);
    expect(sql).toMatch(/AND \(TraceId > \{v\d+:String\} AND OccurredAt >=/);
    expect(sql).toMatch(/HAVING min\(CreatedAt\) >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
    expect(sql).toContain("ORDER BY TraceId ASC LIMIT 5000");
    expect(Object.values(statements[0]?.params ?? {})).toEqual(
      expect.arrayContaining(["t0", fromMs, toMs]),
    );
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
