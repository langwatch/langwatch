/**
 * Integration tests for the single-trace span readers on
 * `SpanStorageClickHouseRepository`, exercised against a real ClickHouse
 * testcontainer on the production `stored_spans` schema.
 *
 * Focus: `getSpansByTraceId` / `getNormalizedSpansByTraceId` must read the
 * heavy `SpanAttributes` payload for at most `limit` spans, not for every span
 * in the trace. A trace with far more spans than the read limit is the shape
 * that tips this path into MEMORY_LIMIT_EXCEEDED in prod, so the test seeds
 * such a trace and asserts both correctness and a real peak-memory reduction
 * versus the naive single-scan form.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { SpanStorageClickHouseRepository } from "../span-storage.clickhouse.repository";

const tenantId = `test-span-fetch-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

// Wide enough that the trace holds many more spans than MAX_DERIVATION_SPANS
// (512), so the naive form pays to read heavy columns for spans it then drops.
const TOTAL_SPANS = 1000;
const READ_LIMIT = 512;
const ATTR_KEYS = 30;
const ATTR_VALUE = "v".repeat(2000); // ~60KB of SpanAttributes per span

let ch: ClickHouseClient;
let repo: SpanStorageClickHouseRepository;

function spanIdFor(i: number): string {
  return `span-${String(i).padStart(4, "0")}`;
}

function heavyAttributes(i: number): Record<string, string> {
  const attrs: Record<string, string> = { idx: String(i) };
  for (let k = 0; k < ATTR_KEYS; k++) {
    attrs[`k${k}`] = ATTR_VALUE;
  }
  return attrs;
}

function makeSpanRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanIdFor(i),
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + i),
    EndTime: new Date(base + i + 50),
    DurationMs: 50,
    SpanName: "test-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: heavyAttributes(i),
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(base + i),
    UpdatedAt: new Date(base + i),
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeSpanRow>[]) {
  const chunk = 250;
  for (let i = 0; i < rows.length; i += chunk) {
    await ch.insert({
      table: "stored_spans",
      values: rows.slice(i, i + chunk),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new SpanStorageClickHouseRepository(async () => ch);

  const rows = Array.from({ length: TOTAL_SPANS }, (_, i) => makeSpanRow(i));
  await insertRows(rows);

  // A stale earlier version of the first span: the dedup must return the
  // latest version (no `stale` marker), never this one.
  await insertRows([
    makeSpanRow(0, {
      SpanAttributes: { idx: "0", stale: "yes" },
      UpdatedAt: new Date(base - 10_000),
      CreatedAt: new Date(base - 10_000),
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("SpanStorageClickHouseRepository single-trace reads (integration)", () => {
  describe("when a trace holds far more spans than the read limit", () => {
    it("returns the earliest `limit` spans ordered by StartTime", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      expect(spans).toHaveLength(READ_LIMIT);
      expect(spans.map((s) => s.spanId)).toEqual(
        Array.from({ length: READ_LIMIT }, (_, i) => spanIdFor(i)),
      );

      const startTimes = spans.map((s) => s.startTimeUnixMs);
      const sorted = [...startTimes].sort((a, b) => a - b);
      expect(startTimes).toEqual(sorted);
    });

    it("returns the latest version of a duplicated span, not the stale one", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      const first = spans.find((s) => s.spanId === spanIdFor(0));
      expect(first).toBeDefined();
      // The stale version carried a `stale` marker; the latest one never did.
      expect(first?.spanAttributes.stale).toBeUndefined();
      expect(String(first?.spanAttributes.idx)).toBe("0");
    });

    it("preserves the full heavy SpanAttributes payload", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      const sample = spans[10]!;
      expect(Object.keys(sample.spanAttributes)).toContain("k0");
      expect(sample.spanAttributes.k0).toBe(ATTR_VALUE);
    });

    it("reads heavy columns for fewer spans than the naive single-scan form", async () => {
      const dedup = `(TenantId, TraceId, SpanId, UpdatedAt) IN (
        SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
        FROM stored_spans
        WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
        GROUP BY TenantId, TraceId, SpanId
      )`;

      const naiveId = `naive-${nanoid()}`;
      const pagedId = `paged-${nanoid()}`;

      // Naive: materialize SpanAttributes for every deduped span, then trim.
      await ch
        .query({
          query: `
            SELECT SpanId, SpanAttributes
            FROM stored_spans
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
              AND ${dedup}
            ORDER BY StartTime ASC
            LIMIT {limit:UInt32}
          `,
          query_params: { tenantId, traceId, limit: READ_LIMIT },
          query_id: naiveId,
          format: "JSONEachRow",
        })
        .then((r) => r.json());

      // Paged: pick the SpanId set first, read SpanAttributes for those only.
      await ch
        .query({
          query: `
            SELECT SpanId, SpanAttributes
            FROM stored_spans
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
              AND SpanId IN (
                SELECT SpanId
                FROM stored_spans
                WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
                  AND ${dedup}
                ORDER BY StartTime ASC
                LIMIT {limit:UInt32}
              )
              AND ${dedup}
            ORDER BY StartTime ASC
            LIMIT {limit:UInt32}
          `,
          query_params: { tenantId, traceId, limit: READ_LIMIT },
          query_id: pagedId,
          format: "JSONEachRow",
        })
        .then((r) => r.json());

      await ch.exec({ query: "SYSTEM FLUSH LOGS" });

      const memRows = (await (
        await ch.query({
          query: `
            SELECT query_id, max(memory_usage) AS mem
            FROM system.query_log
            WHERE query_id IN ({naiveId:String}, {pagedId:String})
              AND type = 'QueryFinish'
            GROUP BY query_id
          `,
          query_params: { naiveId, pagedId },
          format: "JSONEachRow",
        })
      ).json()) as Array<{ query_id: string; mem: string }>;

      const memOf = (id: string) =>
        Number(memRows.find((r) => r.query_id === id)?.mem ?? 0);
      const naiveMem = memOf(naiveId);
      const pagedMem = memOf(pagedId);

      expect(naiveMem).toBeGreaterThan(0);
      expect(pagedMem).toBeGreaterThan(0);
      expect(pagedMem).toBeLessThan(naiveMem);
    });
  });
});
