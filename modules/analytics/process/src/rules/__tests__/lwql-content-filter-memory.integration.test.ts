/**
 * The content filter every LangWatchQL map column is built with, run on ClickHouse under a cap.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../__tests__/migrated-clickhouse.harness.ts";
import { clickHouseLiteral } from "../langwatch-ql-sql-literal.rules.ts";
import {
  CONTENT_ATTRIBUTE_KEYS,
  contentFilteredMapSql,
  contentKeyExclusionSql,
} from "../lwql-content-gating.rules.ts";

const TRACE_COUNT = 30_000;
const KEYS_PER_TRACE = 14;
/** The old prefix lambda peaked near 660 MiB on this data; the regex near 35 MiB. */
const MEMORY_CAP_BYTES = "200000000";

/** One block of traces, as the view's read-in-order dedup hands them to the projection. */
const TRACE_ATTRIBUTES = `(
  SELECT CAST(mapFromArrays(
    arrayMap(i -> concat('metadata.dimension_', toString(i), '_', toString(number % 7)), range(${KEYS_PER_TRACE})),
    arrayMap(i -> 'value', range(${KEYS_PER_TRACE}))
  ) AS Map(String, String)) AS Attributes
  FROM numbers(${TRACE_COUNT})
  ORDER BY number
  LIMIT 1 BY number
)`;

/** The catalog's own rule, written apart from the pattern: a key alone, or followed by a dot. */
function isCatalogContentKey(key: string): boolean {
  return CONTENT_ATTRIBUTE_KEYS.some((content) => key === content || key.startsWith(`${content}.`));
}

const PROBE_KEYS = [
  ...CONTENT_ATTRIBUTE_KEYS,
  ...CONTENT_ATTRIBUTE_KEYS.map((key) => `${key}.0.content`),
  ...CONTENT_ATTRIBUTE_KEYS.map((key) => `${key}x`),
  ...CONTENT_ATTRIBUTE_KEYS.map((key) => `x${key}`),
  // Differs from a content key only where it has a dot, so an unescaped dot would drop it.
  ...CONTENT_ATTRIBUTE_KEYS.filter((key) => key.includes(".")).flatMap((key) => [
    key.replaceAll(".", "_"),
    key.replaceAll(".", "X"),
  ]),
  "gen_ai.request.model",
  "gen_ai.prompt_id",
  "metadata.task_type",
  "",
];

describe("given the content filter of the LangWatchQL map columns", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
  });

  describe("when it runs over a month of a busy project's trace attributes in one block", () => {
    /** @scenario "The content filter on a view's map column stays within a widget's memory cap" */
    it("answers under the memory cap", async () => {
      const result = await ch.query({
        query:
          `SELECT count() AS traces, sum(length(${contentFilteredMapSql("Attributes")})) AS kept ` +
          `FROM ${TRACE_ATTRIBUTES}`,
        format: "JSONEachRow",
        clickhouse_settings: {
          max_memory_usage: MEMORY_CAP_BYTES,
          max_threads: 4,
          max_block_size: "65505",
        },
      });
      const [row] = await result.json<{ traces: string; kept: string }>();

      expect(Number(row?.traces)).toBe(TRACE_COUNT);
      expect(Number(row?.kept)).toBe(TRACE_COUNT * KEYS_PER_TRACE);
    });
  });

  describe("when ClickHouse evaluates it on content keys and their neighbours", () => {
    /** @scenario "The content filter on a view's map column stays within a widget's memory cap" */
    it("keeps exactly the keys the data privacy catalog does not call content", async () => {
      const keys = PROBE_KEYS.map((key) => clickHouseLiteral(key)).join(", ");
      const result = await ch.query({
        query: `SELECT k, ${contentKeyExclusionSql("k")} AS kept FROM (SELECT arrayJoin([${keys}]) AS k)`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{ k: string; kept: number }>();

      expect(rows).toHaveLength(PROBE_KEYS.length);
      for (const row of rows) {
        expect(Boolean(row.kept), `ClickHouse and the catalog disagree on "${row.k}"`).toBe(
          !isCatalogContentKey(row.k),
        );
      }
    });
  });
});
