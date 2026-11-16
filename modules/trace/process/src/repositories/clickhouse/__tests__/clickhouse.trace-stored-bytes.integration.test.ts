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
const at = "2026-11-01 12:00:00.000";

let ch: ClickHouseClient;

/** One trace summary and one span with fixed payloads, so `_size_bytes` is a known figure. */
async function store({ tenantId, payload }: { tenantId: string; payload: string }) {
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
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    Attributes: { "langwatch.payload": payload },
  });
  await insert("stored_spans", {
    ProjectionId: `span-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: nanoid(16),
    Sampled: 1,
    StartTime: at,
    EndTime: at,
    DurationMs: 100,
    SpanName: "stored-bytes",
    SpanKind: 1,
    ServiceName: "stored-bytes",
    ScopeName: "stored-bytes",
    SpanAttributes: { "langwatch.payload": payload },
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
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({ours:String}, {theirs:String})`,
        query_params: { ours, theirs },
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
});
