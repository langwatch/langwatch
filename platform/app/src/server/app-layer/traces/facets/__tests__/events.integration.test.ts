/**
 * Integration coverage for the events facet against a real ClickHouse.
 *
 * The facet counts event names and, for events that carry `event.metrics.*`
 * attributes, buckets their values. `Events.Attributes` is
 * `Array(Map(LowCardinality(String), String))`, and on real traffic most of
 * its weight is payload on events that carry no metric at all. Reading it in
 * one pass alongside the name counts materialises every one of those values;
 * on a busy tenant that is what tips the facet into MEMORY_LIMIT_EXCEEDED
 * against the ceiling in KEY_DISCOVERY_SETTINGS.
 *
 * The facet now counts names from `Events.Name` alone and reads the map only
 * for spans whose `.keys` subcolumn holds a metric key. These tests pin both
 * halves of that: the answer is exactly what the seed implies, and under a
 * memory budget tight enough to expose the difference the facet completes
 * while the single-pass shape it replaced does not. The budget is scaled down
 * to container size; prod hits the identical wall at 2 GiB.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { EVENT_METRICS_PREFIX } from "../../query-language/eventMetrics";
import { buildEventsFacetQuery } from "../events";
import { baseParams, buildTimeWhere } from "../helpers";

const TENANT_ID = "facet-events-metric-gate-test";

// Small in rows, lopsided in shape. Every span carries heavy payload events
// with no metric keys; one span in VOTE_EVERY also carries a vote event. What
// separates the two shapes is how much payload sits beside the votes, not the
// row count, so this discriminates sharply while staying light enough to seed
// alongside the sibling facet suites in one container.
const SPAN_COUNT = 800;
const PAYLOAD_EVENTS = ["log-0", "log-1", "log-2"];
const PAYLOAD_KEYS_PER_EVENT = 5;
/** Heavy, so the values column is what makes the difference. */
const PAYLOAD_VALUE_SIZE = 4096;
const VOTE_EVERY = 20;
const UP_VOTE_EVERY = 60;

const VOTE_EVENT = "thumbs_up_down";
const VOTE_KEY = `${EVENT_METRICS_PREFIX}vote`;
const SEP = String.fromCharCode(31);

const VOTING_SPANS = SPAN_COUNT / VOTE_EVERY;
const UP_VOTES = Math.ceil(SPAN_COUNT / UP_VOTE_EVERY);
const DOWN_VOTES = VOTING_SPANS - UP_VOTES;

// Tight enough that reading every payload value OOMs, loose enough that the
// gated read completes. Tuned against CH 25.10 on the seed above.
const MEMORY_CAP = "40000000"; // 40 MB

type FacetRow = {
  facet_value: string;
  cnt: string;
  metric_values: Array<[string, number]>;
  total_distinct: string;
};

async function seedSpansWithEvents({
  ch,
}: {
  ch: ClickHouseClient;
}): Promise<void> {
  const now = Date.now();
  const payload = Object.fromEntries(
    Array.from({ length: PAYLOAD_KEYS_PER_EVENT }, (_, k) => [
      `payload_${k}`,
      "v".repeat(PAYLOAD_VALUE_SIZE),
    ]),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < SPAN_COUNT; i++) {
    const votes = i % VOTE_EVERY === 0;
    const names = votes ? [...PAYLOAD_EVENTS, VOTE_EVENT] : PAYLOAD_EVENTS;
    const attributes = names.map((name) =>
      name === VOTE_EVENT
        ? { [VOTE_KEY]: i % UP_VOTE_EVERY === 0 ? "1" : "-1" }
        : payload,
    );
    rows.push({
      ProjectionId: `proj-events-facet-${i}`,
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
      "Events.Timestamp": names.map(() => new Date(now - i * 10)),
      "Events.Name": names,
      "Events.Attributes": attributes,
      "Links.TraceId": [],
      "Links.SpanId": [],
      "Links.Attributes": [],
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
    });
  }

  // Voting spans go in their own inserts, so they land in their own parts.
  // The gate works at granule granularity: PREWHERE can only skip reading
  // Events.Attributes for a granule in which no row passes, so a granule
  // holding one voting span still reads every payload beside it. Separating
  // them here is what exercises the saving, and it states the condition the
  // saving depends on in production too.
  const isVoting = (row: Record<string, unknown>) =>
    (row["Events.Name"] as string[]).includes(VOTE_EVENT);
  const ordered = [
    ...rows.filter((row) => !isVoting(row)),
    ...rows.filter(isVoting),
  ];
  const BATCH = 200;
  for (let i = 0; i < ordered.length; i += BATCH) {
    const batch = ordered.slice(i, i + BATCH);
    const voting = batch.filter(isVoting);
    const payloadOnly = batch.filter((row) => !isVoting(row));
    for (const values of [payloadOnly, voting]) {
      if (values.length === 0) continue;
      await ch.insert({
        table: "stored_spans",
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }
  }
}

/**
 * The single-pass shape this facet replaced: names and metric buckets both
 * read from one zip of `Events.Name` with the whole `Events.Attributes` map.
 * Kept here only as the witness that the memory test discriminates.
 */
function singlePassSql(where: string): string {
  return `
    SELECT name AS facet_value, count() AS cnt
    FROM (
      SELECT ev.1 AS name,
        arrayFilter(
          x -> startsWith(x.1, '${EVENT_METRICS_PREFIX}') AND x.2 != '',
          arrayZip(mapKeys(ev.2), mapValues(ev.2))
        ) AS metric_entries
      FROM (
        SELECT arrayJoin(arrayZip(\`Events.Name\`, \`Events.Attributes\`)) AS ev
        FROM stored_spans
        WHERE ${where}
          AND length(\`Events.Name\`) > 0
      )
      WHERE ev.1 != ''
    )
    GROUP BY name
  `;
}

describe("events facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);
    await seedSpansWithEvents({ ch });
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

  async function runFacet(
    settings: Record<string, string> = {},
  ): Promise<FacetRow[]> {
    const query = buildEventsFacetQuery(ctx);
    const result = await ch.query({
      query: query.sql,
      query_params: query.params,
      format: "JSONEachRow",
      clickhouse_settings: { ...query.settings, ...settings },
    });
    return result.json<FacetRow>();
  }

  describe("given spans with heavy payload events and a minority of votes", () => {
    describe("when the facet is built", () => {
      it("counts every event name, including the ones with no metrics", async () => {
        const rows = await runFacet();
        const counts = Object.fromEntries(
          rows.map((r) => [r.facet_value, Number(r.cnt)]),
        );

        expect(counts).toEqual({
          ...Object.fromEntries(PAYLOAD_EVENTS.map((n) => [n, SPAN_COUNT])),
          [VOTE_EVENT]: VOTING_SPANS,
        });
        expect(rows.every((r) => Number(r.total_distinct) === 4)).toBe(true);
      });

      it("buckets the vote values and leaves payload events with none", async () => {
        const rows = await runFacet();
        const byName = new Map(rows.map((r) => [r.facet_value, r]));

        expect(byName.get(VOTE_EVENT)?.metric_values).toEqual([
          [`${VOTE_KEY}${SEP}-1`, DOWN_VOTES],
          [`${VOTE_KEY}${SEP}1`, UP_VOTES],
        ]);
        for (const name of PAYLOAD_EVENTS) {
          expect(byName.get(name)?.metric_values).toEqual([]);
        }
      });
    });

    describe("when the memory budget is too tight to read every payload value", () => {
      it("still completes with the full answer", async () => {
        const rows = await runFacet({ max_memory_usage: MEMORY_CAP });

        expect(rows).toHaveLength(4);
        expect(
          rows.find((r) => r.facet_value === VOTE_EVENT)?.metric_values,
        ).toHaveLength(2);
      });

      it("exceeds the same budget with the single-pass shape it replaced", async () => {
        const sql = singlePassSql(buildTimeWhere("StartTime"));

        await expect(
          ch
            .query({
              query: sql,
              query_params: baseParams(ctx),
              format: "JSONEachRow",
              clickhouse_settings: { max_memory_usage: MEMORY_CAP },
            })
            .then((r) => r.json()),
        ).rejects.toThrow(/memory limit exceeded/i);
      });
    });
  });
});
