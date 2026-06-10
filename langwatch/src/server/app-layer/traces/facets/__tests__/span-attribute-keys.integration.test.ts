/**
 * Integration coverage for the span-attribute-keys discovery facet against a
 * real ClickHouse.
 *
 * The facet explodes `arrayJoin(SpanAttributes.keys)` to discover every
 * distinct attribute key. The trap is the empty-map short-circuit: probing
 * `length(SpanAttributes)` makes ClickHouse materialise the whole Map (keys
 * AND values) just to count entries, dragging the heavy values column into
 * memory. On busy tenants that tips the query into MEMORY_LIMIT_EXCEEDED
 * (observed 110x/24h in prod). Probing `length(SpanAttributes.keys)` instead
 * keeps the whole query on the lightweight keys subcolumn.
 *
 * This test reproduces the failure shape on a small container: under a tight
 * memory budget the keys-subcolumn query completes and returns the correct
 * key list. The pre-fix `length(SpanAttributes)` variant is asserted to blow
 * the same budget, so this is a real regression test, not a string check.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import { seedSpans } from "../../../../analytics/clickhouse/__tests__/test-utils/clickhouse-fixtures";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { buildSpanAttributeKeysFacetQuery } from "../span-attribute-keys";

const TENANT_ID = "facet-span-attr-keys-test";
const ATTRIBUTE_KEYS = 80;
// seedSpans adds one extra synthetic key ("langwatch.span.type") on top of the
// attr_key_0..N-1 it generates.
const EXPECTED_DISTINCT_KEYS = ATTRIBUTE_KEYS + 1;

// Tight enough that reading the values column OOMs, loose enough that the
// keys-only read completes comfortably. Tuned against CH 25.10 on the seed below.
const MEMORY_CAP = "95000000"; // 95 MB

type FacetRow = { facet_value: string; cnt: string; total_distinct: string };

describe("span-attribute-keys facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);

    await seedSpans(ch, {
      tenantId: TENANT_ID,
      count: 40_000,
      attributeKeys: ATTRIBUTE_KEYS,
      attributeValueSize: 512, // heavy values — the column we must NOT read
      traceCount: 1000,
    });
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
      const query = buildSpanAttributeKeysFacetQuery(ctx);
      const result = await ch.query({
        query: query.sql,
        query_params: query.params,
        format: "JSONEachRow",
        clickhouse_settings: { max_memory_usage: MEMORY_CAP },
      });
      const rows = await result.json<FacetRow>();

      const keys = rows.map((r) => r.facet_value);
      expect(new Set(keys).size).toBe(keys.length); // GROUP BY => no dupes
      expect(keys).toContain("langwatch.span.type");
      expect(keys).toContain("attr_key_0");
      expect(keys).not.toContain(""); // empty keys filtered out
      expect(rows).toHaveLength(EXPECTED_DISTINCT_KEYS);
      expect(Number(rows[0]?.total_distinct)).toBe(EXPECTED_DISTINCT_KEYS);
    });
  });

  describe("when probing the whole Map instead of the keys subcolumn", () => {
    it("blows the same memory budget (the bug this fixes)", async () => {
      // Identical query except the empty-map short-circuit reads the full
      // Map. This is the pre-fix shape; it must exceed the budget that the
      // keys-only query clears.
      const query = buildSpanAttributeKeysFacetQuery(ctx);
      const preFixSql = query.sql.replace(
        "length(SpanAttributes.keys) > 0",
        "length(SpanAttributes) > 0",
      );
      expect(preFixSql).not.toBe(query.sql); // guard: the replace actually hit

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
