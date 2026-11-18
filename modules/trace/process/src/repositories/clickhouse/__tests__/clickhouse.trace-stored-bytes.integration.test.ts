/** @vitest-environment node */

/**
 * The storage meter's question to trace: one project's `_size_bytes` over its spans and trace
 * summaries, read on 26.8 as a built read for that project alone.
 * @see modules/trace/specs/trace-stored-bytes.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceUsageCountClickHouseRepository } from "../trace-usage-count.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const run = nanoid(8);
const ours = `stored-bytes-ours-${run}`;
const theirs = `stored-bytes-theirs-${run}`;
const aged = `stored-bytes-aged-${run}`;
const DAY_MS = 86_400_000;
const now = Date.now();
const at = "2026-11-01 12:00:00.000";

let ch: ClickHouseClient;

/** One trace summary and one span with fixed payloads, so `_size_bytes` is a known figure. */
async function store({
  tenantId,
  payload,
  occurredAt = at,
  retentionDays,
}: {
  tenantId: string;
  payload: string;
  occurredAt?: string;
  retentionDays?: number;
}) {
  const kept = retentionDays === undefined ? {} : { _retention_days: retentionDays };
  const traceId = `trace-${nanoid()}`;
  const insert = (table: string, row: Record<string, unknown>) =>
    ch.insert({
      table,
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, date_time_input_format: "best_effort" },
    });
  await insert("trace_summaries", {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    Attributes: { "langwatch.payload": payload },
    ...kept,
  });
  await insert("stored_spans", {
    ProjectionId: `span-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: nanoid(16),
    Sampled: 1,
    StartTime: occurredAt,
    EndTime: occurredAt,
    DurationMs: 100,
    SpanName: "stored-bytes",
    SpanKind: 1,
    ServiceName: "stored-bytes",
    ScopeName: "stored-bytes",
    SpanAttributes: { "langwatch.payload": payload },
    ...kept,
  });
}

describe.skipIf(!testClickHouseConfigured())("trace's stored bytes (real ClickHouse)", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    await store({ tenantId: ours, payload: "ours" });
    await store({
      tenantId: theirs,
      payload: "a much longer payload belonging to another project",
    });
    const daysAgo = (days: number) =>
      new Date(now - days * DAY_MS).toISOString().replace("T", " ").replace("Z", "");
    await store({ tenantId: aged, payload: "old", occurredAt: daysAgo(120), retentionDays: 371 });
    await store({ tenantId: aged, payload: "kept", occurredAt: daysAgo(120), retentionDays: 0 });
    await store({ tenantId: aged, payload: "new", occurredAt: daysAgo(0), retentionDays: 371 });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({ours:String}, {theirs:String}, {aged:String})`,
        query_params: { ours, theirs, aged },
      });
    }
  });

  /** @scenario "Trace's stored bytes count only this project's rows" */
  it("sums this project's span and summary `_size_bytes`, none of the other project's", async () => {
    const repository = TraceUsageCountClickHouseRepository.create(traceQueryClientFor(ch));

    const ourBytes = await repository.getStoredBytes({ tenantId: ours });
    const theirBytes = await repository.getStoredBytes({ tenantId: theirs });

    expect({ ourBytes, theirBytes }).toEqual({ ourBytes: 306, theirBytes: 398 });
  });

  /** @scenario "The storage read filters trace's tables on their partition columns" */
  it("filters spans and summaries on the columns their partition keys are built from", async () => {
    const result = await ch.query({
      query:
        "SELECT name, partition_key FROM system.tables WHERE database = currentDatabase() AND name IN ('stored_spans', 'trace_summaries')",
      format: "JSONEachRow",
    });
    const rows: { name: string; partition_key: string }[] = await result.json();
    const keys = Object.fromEntries(rows.map((row) => [row.name, row.partition_key]));

    expect(keys.stored_spans).toContain("StartTime");
    expect(keys.trace_summaries).toContain("OccurredAt");
  });

  /** @scenario "The storage read counts only rows written before the cutoff" */
  it("counts the bytes of spans and summaries older than the cutoff only", async () => {
    const repository = TraceUsageCountClickHouseRepository.create(traceQueryClientFor(ch));

    const older = await repository.getStoredBytes({ tenantId: aged, beforeMs: now - 91 * DAY_MS });
    const everything = await repository.getStoredBytes({ tenantId: aged });
    const beforeTomorrow = await repository.getStoredBytes({
      tenantId: aged,
      beforeMs: now + DAY_MS,
    });

    expect(older).toBeGreaterThan(0);
    expect(older).toBeLessThan(everything);
    expect(beforeTomorrow).toBe(everything);
  });

  it("counts the old traces a shorter period would remove, each once", async () => {
    const repository = TraceUsageCountClickHouseRepository.create(traceQueryClientFor(ch));
    const count = (retentionDays: number) =>
      repository.countStoredPastRetention({
        tenantId: aged,
        beforeMs: now - retentionDays * DAY_MS,
        retentionDays,
      });

    // Both 120-day-old traces are past 91 days (one kept forever); none is past 130.
    expect(await count(91)).toBe(2);
    expect(await count(130)).toBe(0);
  });
});
