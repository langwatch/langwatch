/**
 * Integration coverage for the event-attribute-keys discovery facet against a
 * real ClickHouse.
 *
 * `Events.Attributes` is `Array(Map(LowCardinality(String), String))` — one
 * map per event per span. Listing the distinct keys needs only the keys, but
 * touching the Map itself makes ClickHouse materialise the `String` values
 * beside them. On a tenant with busy events that is what tips the facet into
 * MEMORY_LIMIT_EXCEEDED against the ceiling in KEY_DISCOVERY_SETTINGS
 * (observed 18x in one day in prod, all one tenant, all this facet).
 *
 * Reading `Events.Attributes.keys` instead gives
 * `Array(Array(LowCardinality(String)))` and never opens the values column.
 *
 * The assertion is behavioural, not a string check: under a memory budget
 * tight enough to expose the difference, the subcolumn query completes and
 * returns the correct key list while the pre-fix shape blows the same budget.
 * The budget is scaled down to container size; prod hits the identical wall
 * at 2 GiB.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { buildEventAttributeKeysFacetQuery } from "../event-attribute-keys";

const TENANT_ID = "facet-event-attr-keys-test";

// Deliberately small in rows and lopsided in shape: few distinct keys, very
// large values. What separates the two queries is the values-to-keys ratio,
// not the row count, so this discriminates sharply while staying light enough
// to seed alongside the sibling facet suite in one container.
const SPAN_COUNT = 800;
const EVENTS_PER_SPAN = 4;
const KEYS_PER_EVENT = 5;
/** Heavy, so the values column is what makes the difference. */
const VALUE_SIZE = 4096;

const EXPECTED_DISTINCT_KEYS = KEYS_PER_EVENT;

// Tight enough that dragging in the values column OOMs, loose enough that the
// keys-only read completes. Tuned against CH 25.10 on the seed below.
const MEMORY_CAP = "40000000"; // 40 MB

type FacetRow = { facet_value: string; cnt: string; total_distinct: string };

async function seedSpansWithEvents(ch: ClickHouseClient): Promise<void> {
  const now = Date.now();
  const value = "v".repeat(VALUE_SIZE);
  const eventAttributes = Object.fromEntries(
    Array.from({ length: KEYS_PER_EVENT }, (_, k) => [`event_key_${k}`, value]),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < SPAN_COUNT; i++) {
    rows.push({
      ProjectionId: `proj-event-attr-${i}`,
      TenantId: TENANT_ID,
      TraceId: `${TENANT_ID}-trace-${i % 200}`,
      SpanId: `span-${i}`,
      ParentSpanId: null,
      ParentTraceId: null,
      ParentIsRemote: null,
      Sampled: 1,
      StartTime: new Date(now - i * 10),
      EndTime: new Date(now - i * 10 + 5),
      DurationMs: 5,
      SpanName: "test-span",
      SpanKind: 1,
      ServiceName: "test-service",
      ResourceAttributes: {},
      SpanAttributes: {},
      StatusCode: 1,
      StatusMessage: "",
      ScopeName: "",
      ScopeVersion: null,
      "Events.Timestamp": Array.from(
        { length: EVENTS_PER_SPAN },
        () => new Date(now - i * 10),
      ),
      "Events.Name": Array.from(
        { length: EVENTS_PER_SPAN },
        (_, e) => `event-${e}`,
      ),
      "Events.Attributes": Array.from(
        { length: EVENTS_PER_SPAN },
        () => eventAttributes,
      ),
      "Links.TraceId": [],
      "Links.SpanId": [],
      "Links.Attributes": [],
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
    });
  }

  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await ch.insert({
      table: "stored_spans",
      values: rows.slice(i, i + BATCH),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

describe("event-attribute-keys facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);
    await seedSpansWithEvents(ch);
  }, 180_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  const ctx = {
    tenantId: TENANT_ID,
    // Wide window: seeded spans land within a few minutes of now.
    timeRange: { from: Date.now() - 60 * 60 * 1000, to: Date.now() + 60_000 },
    limit: 1000,
    offset: 0,
  };

  describe("when discovering keys under a tight memory budget", () => {
    it("completes and returns every distinct key exactly once", async () => {
      const query = buildEventAttributeKeysFacetQuery(ctx);
      const result = await ch.query({
        query: query.sql,
        query_params: query.params,
        format: "JSONEachRow",
        clickhouse_settings: { max_memory_usage: MEMORY_CAP },
      });
      const rows = await result.json<FacetRow>();

      const keys = rows.map((r) => r.facet_value);
      expect(new Set(keys).size).toBe(keys.length); // GROUP BY => no dupes
      expect(keys).toContain("event_key_0");
      expect(keys).toContain(`event_key_${KEYS_PER_EVENT - 1}`);
      expect(keys).not.toContain(""); // empty keys filtered out
      expect(rows).toHaveLength(EXPECTED_DISTINCT_KEYS);
      expect(Number(rows[0]?.total_distinct)).toBe(EXPECTED_DISTINCT_KEYS);
    });

    it("counts every (span, event) occurrence of a key, as before the fix", async () => {
      // The subcolumn must not change multiplicity: one row per key per event
      // per span, which is what orders the sidebar by frequency.
      const query = buildEventAttributeKeysFacetQuery(ctx);
      const result = await ch.query({
        query: query.sql,
        query_params: query.params,
        format: "JSONEachRow",
        clickhouse_settings: { max_memory_usage: MEMORY_CAP },
      });
      const rows = await result.json<FacetRow>();

      for (const row of rows) {
        expect(Number(row.cnt)).toBe(SPAN_COUNT * EVENTS_PER_SPAN);
      }
    });
  });

  describe("when reading the whole Map instead of the keys subcolumn", () => {
    it("blows the same memory budget (the bug this fixes)", async () => {
      // Identical query except both the projection and the empty
      // short-circuit go through the Map, dragging the values column in.
      // This is the pre-fix shape; it must exceed the budget the
      // subcolumn query clears.
      const query = buildEventAttributeKeysFacetQuery(ctx);
      const preFixSql = query.sql
        .replace(
          "arrayJoin(arrayJoin(`Events.Attributes`.keys))",
          "arrayJoin(mapKeys(arrayJoin(`Events.Attributes`)))",
        )
        .replace(
          "length(`Events.Attributes`.keys) > 0",
          "length(`Events.Attributes`) > 0",
        );
      expect(preFixSql).not.toBe(query.sql); // guard: the replaces actually hit
      expect(preFixSql).not.toContain(".keys");

      await expect(
        ch
          .query({
            query: preFixSql,
            query_params: query.params,
            format: "JSONEachRow",
            clickhouse_settings: { max_memory_usage: MEMORY_CAP },
          })
          .then((r) => r.json()),
      ).rejects.toThrow(/memory limit exceeded/i);
    });
  });
});
