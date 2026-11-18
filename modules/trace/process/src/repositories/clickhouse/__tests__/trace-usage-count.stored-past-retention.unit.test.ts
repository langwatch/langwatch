/** Data retention's questions to trace before a cutoff, as built reads (ADR-202 Decided 20). */
import { traceStoredPastRetentionInputSchema } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../memory/memory.trace-usage-count.repository.ts";
import { TraceUsageCountClickHouseRepository } from "../trace-usage-count.repository.ts";

describe("TraceUsageCountClickHouseRepository.storedPastRetentionCountRead()", () => {
  const beforeMs = Date.UTC(2026, 7, 1);
  const statement = TraceUsageCountClickHouseRepository.storedPastRetentionCountRead({
    tenantId: "project_1",
    beforeMs,
    retentionDays: 91,
  });

  /** @scenario "Trace counts the items a shorter period would remove" */
  it("counts distinct `TraceId` before the cutoff, kept forever or longer than the period", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.sql).toContain("FROM trace_summaries");
    expect(statement.sql).toContain("uniqExact(TraceId)");
    expect(statement.sql).toMatch(/OccurredAt\)? < /);
    expect(statement.sql).toMatch(/_retention_days = /);
    expect(statement.sql).toMatch(/_retention_days > /);
    expect(Object.values(statement.params)).toEqual(expect.arrayContaining([beforeMs, 91]));
  });

  /** @scenario "Trace refuses a past-retention count without a period" */
  it("refuses a period of 0 days and a count without a cutoff", () => {
    const refusedPaths = (input: object) =>
      traceStoredPastRetentionInputSchema
        .safeParse(input)
        .error?.issues.map((issue) => issue.path.join("."));

    expect(refusedPaths({ projectId: "project_1", beforeMs, retentionDays: 0 })).toEqual([
      "retentionDays",
    ]);
    expect(refusedPaths({ projectId: "project_1", retentionDays: 91 })).toEqual(["beforeMs"]);
  });
});

describe("TraceUsageCountClickHouseRepository.storedBytesRead() before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Trace's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps spans by StartTime and summaries by OccurredAt, each before the cutoff", () => {
    const statement = TraceUsageCountClickHouseRepository.storedBytesRead({
      tenantId: "project_1",
      beforeMs,
    });

    expect(statement.sql).toMatch(/StartTime\)? < /);
    expect(statement.sql).toMatch(/OccurredAt\)? < /);
    expect(Object.values(statement.params)).toContain(beforeMs);
  });

  it("filters on no time without a cutoff", () => {
    const statement = TraceUsageCountClickHouseRepository.storedBytesRead({
      tenantId: "project_1",
    });

    expect(statement.sql).not.toMatch(/StartTime|OccurredAt/);
  });
});

describe("MemoryTraceUsageCountRepository.countStoredPastRetention()", () => {
  it("counts each old trace once, leaving out newer traces and ones kept shorter", async () => {
    const beforeMs = Date.UTC(2026, 7, 1);
    const memory = MemoryTraceUsageCountRepository.create();
    const trace = (traceId: string, occurredAtMs: number, retentionDays?: number) =>
      memory.record({
        tenantId: "project_1",
        traceId,
        createdAt: "2026-07-01 00:00:00.000",
        occurredAtMs,
        ...(retentionDays === undefined ? {} : { retentionDays }),
      });
    trace("old", beforeMs - 2, 371);
    trace("old", beforeMs - 1, 371);
    trace("forever", beforeMs - 1);
    trace("short", beforeMs - 1, 30);
    trace("new", beforeMs + 1, 371);

    await expect(
      memory.countStoredPastRetention({ tenantId: "project_1", beforeMs, retentionDays: 91 }),
    ).resolves.toBe(2);
  });
});
