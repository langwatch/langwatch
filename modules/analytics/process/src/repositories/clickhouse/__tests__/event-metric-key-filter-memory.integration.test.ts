/**
 * The event metric key filter's per-event predicate, run on ClickHouse under a memory cap.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { resetParamCounter, translateFilter } from "../clickhouse.filter-translator.mapper.ts";

const TABLE = `event_metric_keys_${nanoid(8).replace(/[^A-Za-z0-9]/g, "x")}`;
const SPAN_COUNT = 70_000;
const EVENTS_PER_SPAN = 8;
const KEYS_PER_EVENT = 20;
const SEED_SLICE = 2_000;
const FILTER_KEYS = ["zz1", "zz2", "zz3", "zz4", "zz5", "event.metrics.k3_4"];
/** A lambda over the keys peaked near 116 MiB here; one hasAny per event near 49 MiB. */
const MEMORY_CAP_BYTES = "70000000";

/** The span-side condition of the translated filter, with the table's own column names. */
function eventCondition(): { sql: string; params: Record<string, unknown> } {
  resetParamCounter();
  const translation = translateFilter({
    field: "events.metrics.key",
    values: FILTER_KEYS,
    key: "evt1",
  });
  const match = /AND (arrayExists\([\s\S]*"Events\.Attributes"\s*\))\s*\)\s*$/.exec(
    translation.whereClause,
  );
  if (!match) throw new Error(`no event condition in: ${translation.whereClause}`);
  return { sql: match[1]!, params: translation.params };
}

describe("given spans whose events carry attribute maps", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    await ch.command({
      query: `CREATE TABLE ${TABLE} (id UInt64, Events Nested(Name String, Attributes Map(String, String)))
        ENGINE = MergeTree ORDER BY id
        SETTINGS vertical_merge_algorithm_min_rows_to_activate = 1,
          vertical_merge_algorithm_min_columns_to_activate = 1`,
    });
    // Small slices, each merged into one part as it lands: a slice peaks near 54 MiB and each
    // merge reads two parts column by column near 100 MiB, far below a CI server's 1 GiB total.
    // The filter then reads one part in blocks as large as before.
    for (let start = 0; start < SPAN_COUNT; start += SEED_SLICE) {
      await ch.command({
        query: `INSERT INTO ${TABLE} SELECT number,
          arrayMap(e -> concat('evt', toString((number + e) % 3)), range(${EVENTS_PER_SPAN})),
          arrayMap(e -> CAST(mapFromArrays(
            arrayMap(i -> concat('event.metrics.k', toString(i), '_', toString(number % 11)), range(${KEYS_PER_EVENT})),
            arrayMap(i -> concat(repeat('v', 40), toString(number)), range(${KEYS_PER_EVENT}))
          ) AS Map(String, String)), range(${EVENTS_PER_SPAN}))
          FROM numbers(${start}, ${SEED_SLICE})`,
        clickhouse_settings: {
          max_threads: 1,
          max_insert_threads: "1",
          max_block_size: String(SEED_SLICE),
        },
      });
      await ch.command({ query: `OPTIMIZE TABLE ${TABLE} FINAL` });
    }
  }, 120_000);

  afterAll(async () => {
    await ch?.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
  });

  describe("when traces are filtered by the event metric keys of an event type", () => {
    /** @scenario "The event metric key filter matches keys without copying each event's map" */
    it("tests each event's keys with one hasAny, under the memory cap", async () => {
      const condition = eventCondition();
      expect(condition.sql).toContain("hasAny(mapKeys(attrs)");

      const result = await ch.query({
        query: `SELECT count() AS spans FROM ${TABLE} WHERE ${condition.sql}`,
        query_params: condition.params,
        format: "JSONEachRow",
        clickhouse_settings: { max_memory_usage: MEMORY_CAP_BYTES, max_threads: 2 },
      });
      const [row] = await result.json<{ spans: string }>();

      // Spans with an evt1 event whose map holds the one key the data carries.
      const expected = await ch.query({
        query:
          `SELECT count() AS spans FROM ${TABLE} WHERE has(arrayMap((n, a) -> ` +
          "n = 'evt1' AND mapContains(a, 'event.metrics.k3_4'), `Events.Name`, `Events.Attributes`), 1)",
        format: "JSONEachRow",
      });
      const [want] = await expected.json<{ spans: string }>();

      expect(Number(want?.spans)).toBeGreaterThan(0);
      expect(Number(row?.spans)).toBe(Number(want?.spans));
    });
  });
});
