/**
 * @vitest-environment node
 * @integration
 * The first-write-wins lookup of the spanAnalytics store against a real span_analytics: a
 * re-sent span is found inside the seven-day window and missed outside it, and another
 * tenant's span with the same ids is never matched.
 * @see specs/trace/span-analytics-written-once.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SpanAnalyticsRow } from "../../../eventing/span-analytics.projection.ts";
import { SpanAnalyticsStore } from "../../../eventing/span-analytics.store.ts";
import { SpanAnalyticsClickHouseRepository } from "../span-analytics.repository.ts";
import { traceResolverFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const TABLE = "span_analytics";
const DAY_MS = 24 * 60 * 60 * 1000;
const tag = nanoid();
const baseMs = Date.now();

let ch: ClickHouseClient;
let store: SpanAnalyticsStore;

function spanRow({
  tenantId,
  spanId,
  startTimeUnixMs = baseMs,
}: {
  tenantId: string;
  spanId: string;
  startTimeUnixMs?: number;
}): SpanAnalyticsRow {
  return {
    tenantId,
    traceId: `${tag}-trace`,
    spanId,
    parentSpanId: null,
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 10,
    durationMs: 10,
    spanName: "span",
    spanKind: 1,
    statusCode: null,
    cost: null,
    nonBilledCost: null,
    spanType: "llm",
    errorType: "",
    ragContextCount: 0,
    inputHash: "0",
    deploymentEnvironment: "",
  };
}

async function countRows({ tenantId, spanId }: { tenantId: string; spanId: string }) {
  const result = await ch.query({
    query: `SELECT count() AS n FROM ${TABLE}
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String} AND SpanId = {spanId:String}`,
    query_params: { tenantId, traceId: `${tag}-trace`, spanId },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: string }>();
  return Number(row?.n);
}

function append(rows: SpanAnalyticsRow[]) {
  const [first] = rows;
  return store.bulkAppend(rows, { tenantId: first?.tenantId } as Parameters<
    SpanAnalyticsStore["bulkAppend"]
  >[1]);
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  store = SpanAnalyticsStore.create({
    storage: SpanAnalyticsClickHouseRepository.create({ resolveClient: traceResolverFor(ch) }),
    defaultRetentionDays: () => 30,
  });
  // Unmerged parts: a merge would hide a duplicate the lookup failed to prevent.
  await ch.exec({ query: `SYSTEM STOP MERGES ${TABLE}` });
}, 60_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({ query: `SYSTEM START MERGES ${TABLE}` });
  await ch.exec({
    query: `ALTER TABLE ${TABLE} DELETE WHERE TraceId = {traceId:String}`,
    query_params: { traceId: `${tag}-trace` },
  });
});

describe.skipIf(!clickHouseConfigured)("span_analytics first-write-wins lookup", () => {
  /** @scenario "A re-sent span is written once in ClickHouse" */
  it("writes a re-sent span once, at the same and at a different start time in the window", async () => {
    const tenantId = `${tag}-resent`;
    await append([spanRow({ tenantId, spanId: "a" })]);
    await append([spanRow({ tenantId, spanId: "a" })]);
    await append([spanRow({ tenantId, spanId: "a", startTimeUnixMs: baseMs + DAY_MS })]);

    expect(await countRows({ tenantId, spanId: "a" })).toBe(1);
  });

  /** @scenario "A re-sent span whose start time moved by under seven days is found" */
  it("finds a re-sent span whose start time moved five days", async () => {
    const tenantId = `${tag}-five-days`;
    await append([spanRow({ tenantId, spanId: "b" })]);
    await append([spanRow({ tenantId, spanId: "b", startTimeUnixMs: baseMs + 5 * DAY_MS })]);

    expect(await countRows({ tenantId, spanId: "b" })).toBe(1);
  });

  /** @scenario "A span re-sent with a StartTime moved more than 7 days is written twice" */
  it("misses a re-sent span whose start time moved eight days", async () => {
    const tenantId = `${tag}-eight-days`;
    await append([spanRow({ tenantId, spanId: "b" })]);
    await append([spanRow({ tenantId, spanId: "b", startTimeUnixMs: baseMs + 8 * DAY_MS })]);

    expect(await countRows({ tenantId, spanId: "b" })).toBe(2);
  });

  /** @scenario "Another tenant's span with the same ids is not matched" */
  it("does not match another tenant's span with the same ids", async () => {
    const tenantA = `${tag}-tenant-a`;
    const tenantB = `${tag}-tenant-b`;
    await append([spanRow({ tenantId: tenantA, spanId: "c" })]);
    await append([spanRow({ tenantId: tenantB, spanId: "c" })]);

    expect(await countRows({ tenantId: tenantA, spanId: "c" })).toBe(1);
    expect(await countRows({ tenantId: tenantB, spanId: "c" })).toBe(1);
  });
});
