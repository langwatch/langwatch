/** @vitest-environment node
 * @integration
 * The event-attribute keys facet against a real ClickHouse: per-key occurrence counts, and
 * under a tight memory budget the keys-subcolumn read completes where the whole-Map read fails.
 * @see specs/traces-v2/search.feature */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { expandStatementForProject } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { EVENT_ATTRIBUTE_KEYS_FACET } from "../clickhouse.trace-facet-event-attribute-keys.repository.ts";

const clickHouseConfigured = testClickHouseConfigured();

// Unique per run: cleanup is an asynchronous mutation, so a fixed tenant could
// still hold a previous run's rows when the next one counts.
const TENANT_ID = `facet-event-attr-keys-test-${nanoid(8)}`;

/** The facet query as the authorized reader would send it for this tenant. */
function forTenant<T extends { sql: string; params: Record<string, unknown> }>(query: T): T {
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

// Between what the two reads need. Measured on CH 25.10 with the seed below and one
// thread: the keys-only read peaks near 3.4 MiB, the whole-Map read near 26 MiB.
const MEMORY_CAP = "12000000"; // 12 MB
/** One thread, so peak read memory doesn't scale with the runner's core count. */
const BUDGET = { max_memory_usage: MEMORY_CAP, max_threads: 1 };

type FacetRow = { facet_value: string; cnt: string; total_distinct: string };

const heavyValue = "v".repeat(VALUE_SIZE);
const everyKey = Object.fromEntries(
  Array.from({ length: KEYS_PER_EVENT }, (_, k) => [`event_key_${k}`, heavyValue]),
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

/** One stored_spans row per span, each carrying EVENTS_PER_SPAN events. */
async function seedSpansWithEvents({ ch }: { ch: ClickHouseClient }): Promise<void> {
  const now = Date.now();
  const rows = Array.from({ length: SPAN_COUNT }, (_, spanIndex) => {
    const at = new Date(now - spanIndex * 10);
    return {
      ProjectionId: `proj-event-attr-${spanIndex}`,
      TenantId: TENANT_ID,
      TraceId: `${TENANT_ID}-trace-${spanIndex % 200}`,
      SpanId: `span-${spanIndex}`,
      StartTime: at,
      EndTime: new Date(at.getTime() + 5),
      SpanName: "test-span",
      "Events.Timestamp": Array.from({ length: EVENTS_PER_SPAN }, () => at),
      "Events.Name": Array.from({ length: EVENTS_PER_SPAN }, (_, e) => `event-${e}`),
      "Events.Attributes": Array.from({ length: EVENTS_PER_SPAN }, (_, eventIndex) =>
        eventAttributesFor({ spanIndex, eventIndex }),
      ),
    };
  });
  // About 80 KB of values per span, so batches stay under 10 MB per insert. The memory
  // budget below was measured on this part layout; changing the batch changes it.
  const BATCH = 120;
  for (let i = 0; i < rows.length; i += BATCH) {
    await ch.insert({
      table: "stored_spans",
      values: rows.slice(i, i + BATCH),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

describe.skipIf(!clickHouseConfigured)("event-attribute-keys facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    if (!clickHouseConfigured) return;
    ch = await startMigratedTraceClickHouse();
    // The budget assumes the parts the seed's batches create, so merges stay stopped.
    await ch.command({ query: "SYSTEM STOP MERGES stored_spans" });
    await seedSpansWithEvents({ ch });
  }, 180_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.command({ query: "SYSTEM START MERGES stored_spans" });
    await ch.command({
      query: "DELETE FROM stored_spans WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: TENANT_ID },
    });
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
      let rows: FacetRow[];

      beforeEach(async () => {
        const query = forTenant(EVENT_ATTRIBUTE_KEYS_FACET.queryBuilder(ctx));
        const result = await ch.query({
          query: query.sql,
          query_params: query.params,
          format: "JSONEachRow",
          clickhouse_settings: BUDGET,
        });
        rows = await result.json<FacetRow>();
      });

      /** @scenario Event-attribute keys load when events carry large values */
      it("completes and returns every distinct key exactly once", async () => {
        const keys = rows.map((r) => r.facet_value);
        expect(new Set(keys).size).toBe(keys.length); // GROUP BY => no dupes
        expect(keys).toContain("event_key_0");
        expect(keys).toContain(`event_key_${KEYS_PER_EVENT - 1}`);
        expect(keys).not.toContain("");
        expect(rows).toHaveLength(EXPECTED_DISTINCT_KEYS);
        expect(Number(rows[0]?.total_distinct)).toBe(EXPECTED_DISTINCT_KEYS);
      });

      /** @scenario Event-attribute keys are listed once each with how often they occur */
      it("counts every (span, event) occurrence of a key", async () => {
        // One row per key per event per span, which is what orders the
        // sidebar by frequency.

        const keys = rows.map((row) => row.facet_value);
        expect(keys).toHaveLength(EXPECTED_DISTINCT_KEYS);
        expect(new Set(keys).size).toBe(keys.length);
        const counts = Object.fromEntries(rows.map((row) => [row.facet_value, Number(row.cnt)]));
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
      /** @scenario Discovering event-attribute keys does not read their values */
      it("fits the budget that the whole-Map read exceeds", async () => {
        // The same query with the projection and the empty short-circuit
        // reading the Map instead of its keys, which drags the values column
        // in; it must exceed the budget the keys read clears.
        const query = forTenant(EVENT_ATTRIBUTE_KEYS_FACET.queryBuilder(ctx));
        const wholeMapSql = query.sql
          .replace(
            "arrayJoin(arrayJoin(`Events.Attributes`.keys))",
            "arrayJoin(mapKeys(arrayJoin(`Events.Attributes`)))",
          )
          .replace("length(`Events.Attributes`.keys) > 0", "length(`Events.Attributes`) > 0");
        expect(wholeMapSql).not.toBe(query.sql); // guard: the replaces actually hit
        expect(wholeMapSql).not.toContain(".keys");

        const fits = await ch.query({
          query: query.sql,
          query_params: query.params,
          format: "JSONEachRow",
          clickhouse_settings: BUDGET,
        });
        expect(await fits.json()).toHaveLength(EXPECTED_DISTINCT_KEYS);
        await expect(
          ch
            .query({
              query: wholeMapSql,
              query_params: query.params,
              format: "JSONEachRow",
              clickhouse_settings: BUDGET,
            })
            .then((r) => r.json()),
        ).rejects.toMatchObject({ code: "241" }); // MEMORY_LIMIT_EXCEEDED
      });
    });
  });
});
