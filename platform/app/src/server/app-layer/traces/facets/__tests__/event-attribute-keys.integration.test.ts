/**
 * Integration coverage for the event-attribute-keys discovery facet against a
 * real ClickHouse.
 *
 * `Events.Attributes` is `Array(Map(LowCardinality(String), String))`: one
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
 *
 * @see specs/traces-v2/search.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import { expandStatementForProject } from "~/test-utils/authorizationProofs";
import { seedSpans } from "../../../../analytics/clickhouse/__tests__/test-utils/clickhouse-fixtures";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { buildEventAttributeKeysFacetQuery } from "../event-attribute-keys";

// Unique per run: cleanup is an asynchronous mutation, so a fixed tenant could
// still hold a previous run's rows when the next one counts.
const TENANT_ID = `facet-event-attr-keys-test-${nanoid(8)}`;

/** The facet query as the authorized reader would send it for this tenant. */
function forTenant<T extends { sql: string; params: Record<string, unknown> }>(
  query: T,
): T {
  const expanded = expandStatementForProject({
    query: query.sql,
    queryParams: query.params,
    projectId: TENANT_ID,
  });
  return { ...query, sql: expanded.query, params: expanded.queryParams };
}

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

// Most events carry every key with a heavy value, which is the workload the
// memory comparison needs. On every SPARSE_EVERY-th span the first event
// carries no attributes at all and the second carries only the first key, so
// the counts below are per (span, event) occurrence and not one flat number.
const SPARSE_EVERY = 10;
const SPARSE_SPANS = SPAN_COUNT / SPARSE_EVERY;
const TOTAL_EVENTS = SPAN_COUNT * EVENTS_PER_SPAN;
/** Missing only from the empty events. */
const FIRST_KEY_OCCURRENCES = TOTAL_EVENTS - SPARSE_SPANS;
/** Missing from the empty events and from the single-key ones. */
const OTHER_KEY_OCCURRENCES = TOTAL_EVENTS - 2 * SPARSE_SPANS;

// Between what the two reads need. Measured on CH 25.10 with the seed below:
// the keys-only read peaks near 4 MiB, the whole-Map read near 28 MiB.
const MEMORY_CAP = "12000000"; // 12 MB

type FacetRow = { facet_value: string; cnt: string; total_distinct: string };

const heavyValue = "v".repeat(VALUE_SIZE);
const everyKey = Object.fromEntries(
  Array.from({ length: KEYS_PER_EVENT }, (_, k) => [
    `event_key_${k}`,
    heavyValue,
  ]),
);

function eventAttributesFor({
  spanIndex,
  eventIndex,
}: {
  spanIndex: number;
  eventIndex: number;
}): Record<string, string> {
  if (spanIndex % SPARSE_EVERY !== 0) return everyKey;
  if (eventIndex === 0) return {};
  if (eventIndex === 1) return { event_key_0: heavyValue };
  return everyKey;
}

describe("event-attribute-keys facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);
    await seedSpans(ch, {
      tenantId: TENANT_ID,
      count: SPAN_COUNT,
      attributeKeys: 0,
      traceCount: 200,
      events: { perSpan: EVENTS_PER_SPAN, attributesFor: eventAttributesFor },
    });
  }, 180_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  const ctx = {
    // An hour either side of registration: the seed is stamped when setup
    // runs, which can be well after this line is evaluated.
    timeRange: {
      from: Date.now() - 60 * 60 * 1000,
      to: Date.now() + 60 * 60 * 1000,
    },
    limit: 1000,
    offset: 0,
  };

  describe("given seeded spans with event attributes", () => {
    describe("when discovering keys under a tight memory budget", () => {
      /** @scenario Event-attribute keys load when events carry large values */
      it("completes and returns every distinct key exactly once", async () => {
        const query = forTenant(buildEventAttributeKeysFacetQuery(ctx));
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
        expect(keys).not.toContain("");
        expect(rows).toHaveLength(EXPECTED_DISTINCT_KEYS);
        expect(Number(rows[0]?.total_distinct)).toBe(EXPECTED_DISTINCT_KEYS);
      });

      /** @scenario Event-attribute keys are listed once each with how often they occur */
      it("counts every (span, event) occurrence of a key, as before the fix", async () => {
        // The subcolumn must not change multiplicity: one row per key per event
        // per span, which is what orders the sidebar by frequency.
        const query = forTenant(buildEventAttributeKeysFacetQuery(ctx));
        const result = await ch.query({
          query: query.sql,
          query_params: query.params,
          format: "JSONEachRow",
          clickhouse_settings: { max_memory_usage: MEMORY_CAP },
        });
        const rows = await result.json<FacetRow>();

        const counts = Object.fromEntries(
          rows.map((row) => [row.facet_value, Number(row.cnt)]),
        );
        expect(counts).toEqual({
          event_key_0: FIRST_KEY_OCCURRENCES,
          ...Object.fromEntries(
            Array.from({ length: KEYS_PER_EVENT - 1 }, (_, k) => [
              `event_key_${k + 1}`,
              OTHER_KEY_OCCURRENCES,
            ]),
          ),
        });
      });
    });

    describe("when reading the whole Map instead of the keys subcolumn", () => {
      /** @scenario Event-attribute keys load when events carry large values */
      it("blows the same memory budget (the bug this fixes)", async () => {
        // Identical query except both the projection and the empty
        // short-circuit go through the Map, dragging the values column in.
        // This is the pre-fix shape; it must exceed the budget the
        // subcolumn query clears.
        const query = forTenant(buildEventAttributeKeysFacetQuery(ctx));
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
});
