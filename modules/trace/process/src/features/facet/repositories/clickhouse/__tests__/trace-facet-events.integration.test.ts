/** @vitest-environment node
 * @integration
 * The events facet against a real ClickHouse: exact counts and metric buckets, and under a
 * tight memory budget the gated read completes where the former single-pass read fails.
 * @see specs/traces-v2/search.feature */

import type { ClickHouseClient } from "@clickhouse/client";
import { EVENT_METRIC_SEP, EVENT_METRICS_PREFIX } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandStatementForProject } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { EVENT_FACET } from "../clickhouse.trace-facet-events.repository.ts";
import { ClickHouseTraceFacetQueryRepository } from "../clickhouse.trace-facet-query.repository.ts";

const clickHouseConfigured = testClickHouseConfigured();
const facetQueries = ClickHouseTraceFacetQueryRepository.create();

// Unique per run: cleanup is an asynchronous mutation, so a fixed tenant could
// still hold a previous run's rows when the next one counts.
const TENANT_ID = `facet-events-metric-gate-test-${nanoid(8)}`;
// One instant for the seed and the query window, so the window holds the
// seeded spans however long setup takes.
const SEEDED_AT = Date.now();

/** The facet query as the authorized reader would send it for this tenant. */
function forTenant(query: { sql: string; params: Record<string, unknown> }) {
  const expanded = expandStatementForProject({
    query: query.sql,
    queryParams: query.params,
    projectId: TENANT_ID,
  });
  return { sql: expanded.query, params: expanded.queryParams };
}

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
// Occurs only on spans that carry no metric key at all, so it never reaches
// the metrics half and has no row on the right side of the join.
const UNMEASURED_EVENT = "handoff";
const VOTE_KEY = `${EVENT_METRICS_PREFIX}vote`;

const VOTING_SPANS = SPAN_COUNT / VOTE_EVERY;
const NON_VOTING_SPANS = SPAN_COUNT - VOTING_SPANS;
const UP_VOTES = Math.ceil(SPAN_COUNT / UP_VOTE_EVERY);
const DOWN_VOTES = VOTING_SPANS - UP_VOTES;

// Tight enough that reading every payload value OOMs, loose enough that the
// gated read completes. Tuned against CH 25.10 on the seed above.
const MEMORY_CAP = "40000000"; // 40 MB

type FacetRow = {
  facet_value: string;
  cnt: string;
  // UInt64 counts arrive as numbers or quoted strings depending on
  // output_format_json_quote_64bit_integers, so reads go through Number().
  metric_values: [string, number | string][];
  total_distinct: string;
};

const TRACE_COUNT = 200;
const traceIndexOf = (spanIndex: number) => spanIndex % TRACE_COUNT;
/** The traces a search filter keeps: every third, so voting spans fall on both sides. */
const inScope = (traceIndex: number) => traceIndex % 3 === 0;

/** What the facet should answer over the spans `keeps` selects, from the seed's own rules. */
function expectedOver(keeps: (spanIndex: number) => boolean) {
  const names: Record<string, number> = {};
  let up = 0;
  let down = 0;
  for (let i = 0; i < SPAN_COUNT; i++) {
    if (!keeps(i)) continue;
    const votes = i % VOTE_EVERY === 0;
    for (const name of [...PAYLOAD_EVENTS, votes ? VOTE_EVENT : UNMEASURED_EVENT]) {
      names[name] = (names[name] ?? 0) + 1;
    }
    if (votes && i % UP_VOTE_EVERY === 0) up++;
    else if (votes) down++;
  }
  return { names, up, down };
}

/** One trace summary per seeded trace, named for whether the search filter keeps it. */
async function seedTraceSummaries({ ch }: { ch: ClickHouseClient }): Promise<void> {
  const at = new Date(SEEDED_AT);
  await ch.insert({
    table: "trace_summaries",
    values: Array.from({ length: TRACE_COUNT }, (_, t) => ({
      ProjectionId: `proj-events-facet-trace-${t}`,
      TenantId: TENANT_ID,
      TraceId: `${TENANT_ID}-trace-${t}`,
      Version: "v1",
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      LastEventOccurredAt: at,
      TraceName: inScope(t) ? "in-scope" : "out-of-scope",
    })),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function seedSpansWithEvents({ ch }: { ch: ClickHouseClient }): Promise<void> {
  const now = SEEDED_AT;
  const payload = Object.fromEntries(
    Array.from({ length: PAYLOAD_KEYS_PER_EVENT }, (_, k) => [
      `payload_${k}`,
      "v".repeat(PAYLOAD_VALUE_SIZE),
    ]),
  );

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < SPAN_COUNT; i++) {
    const votes = i % VOTE_EVERY === 0;
    const names = votes ? [...PAYLOAD_EVENTS, VOTE_EVENT] : [...PAYLOAD_EVENTS, UNMEASURED_EVENT];
    const attributes = names.map((name) => {
      if (name === VOTE_EVENT) {
        return { [VOTE_KEY]: i % UP_VOTE_EVERY === 0 ? "1" : "-1" };
      }
      return name === UNMEASURED_EVENT ? {} : payload;
    });
    rows.push({
      ProjectionId: `proj-events-facet-${i}`,
      TenantId: TENANT_ID,
      TraceId: `${TENANT_ID}-trace-${traceIndexOf(i)}`,
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

  // Voting spans get their own inserts, so their own parts: PREWHERE skips the map only for
  // a granule in which no row passes, so a voting span reads every payload in its granule.
  const isVoting = (row: Record<string, unknown>) =>
    (row["Events.Name"] as string[]).includes(VOTE_EVENT);
  const ordered = [...rows.filter((row) => !isVoting(row)), ...rows.filter(isVoting)];
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

/** The query this facet replaced, verbatim: the witness that the memory test
 * discriminates, so it must stay the real former query, not a simplification. */
function formerSinglePassSql(where: string): string {
  return `
    SELECT
      name AS facet_value,
      cnt,
      arraySlice(
        arrayReverseSort(x -> x.2, arrayZip(metric_buckets.1, metric_buckets.2)),
        1, 10
      ) AS metric_values,
      count() OVER () AS total_distinct
    FROM (
      SELECT
        name,
        count() AS cnt,
        sumMap(
          arrayMap(x -> concat(x.1, char(31), x.2), metric_entries),
          arrayMap(x -> toUInt64(1), metric_entries)
        ) AS metric_buckets
      FROM (
        SELECT
          ev.1 AS name,
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
      WHERE 1 = 1
      GROUP BY name
    )
    ORDER BY cnt DESC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;
}

describe.skipIf(!clickHouseConfigured)("events facet integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    if (!clickHouseConfigured) return;
    ch = await startMigratedTraceClickHouse();
    // The seed puts voting spans in parts of their own, and the memory test
    // depends on that layout. A background merge would fold them back in with
    // the payload spans, so merges on stored_spans stay stopped for the suite.
    await ch.command({ query: "SYSTEM STOP MERGES stored_spans" });
    await seedSpansWithEvents({ ch });
    await seedTraceSummaries({ ch });
  }, 180_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.command({ query: "SYSTEM START MERGES stored_spans" });
    for (const table of ["stored_spans", "trace_summaries"]) {
      await ch.command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  });

  const ctx = {
    // Wide window around the instant the seed is stamped with.
    timeRange: { from: SEEDED_AT - 60 * 60 * 1000, to: SEEDED_AT + 60_000 },
    limit: 1000,
    offset: 0,
  };

  async function runFacet(
    settings: Record<string, string> = {},
    filterWhere?: { sql: string; params: Record<string, unknown> },
  ): Promise<FacetRow[]> {
    const built = EVENT_FACET.queryBuilder({ ...ctx, ...(filterWhere ? { filterWhere } : {}) });
    const query = { ...built, ...forTenant(built) };
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
      /** @scenario Event rows carry exactly the metric values their events recorded */
      it("counts every event name, including the ones with no metrics", async () => {
        const rows = await runFacet();
        const counts = Object.fromEntries(rows.map((r) => [r.facet_value, Number(r.cnt)]));

        expect(counts).toEqual({
          ...Object.fromEntries(PAYLOAD_EVENTS.map((n) => [n, SPAN_COUNT])),
          [VOTE_EVENT]: VOTING_SPANS,
          [UNMEASURED_EVENT]: NON_VOTING_SPANS,
        });
        expect(rows.every((r) => Number(r.total_distinct) === 5)).toBe(true);
      });

      /** @scenario Event rows carry exactly the metric values their events recorded */
      it("buckets the vote values and leaves payload events with none", async () => {
        const rows = await runFacet();
        const byName = new Map(rows.map((r) => [r.facet_value, r]));

        const buckets = byName
          .get(VOTE_EVENT)
          ?.metric_values.map(([key, count]) => [key, Number(count)]);
        expect(buckets).toEqual([
          [`${VOTE_KEY}${EVENT_METRIC_SEP}-1`, DOWN_VOTES],
          [`${VOTE_KEY}${EVENT_METRIC_SEP}1`, UP_VOTES],
        ]);
        for (const name of PAYLOAD_EVENTS) {
          expect(byName.get(name)?.metric_values).toEqual([]);
        }
      });

      /** @scenario Event rows carry exactly the metric values their events recorded */
      it("gives an event that never sits beside a metric an empty list, not a missing one", async () => {
        const rows = await runFacet();
        const unmeasured = rows.find((r) => r.facet_value === UNMEASURED_EVENT);

        // This name has no row in the metrics half, so the join misses. It
        // must still come back with a count and an empty list of values.
        expect(Number(unmeasured?.cnt)).toBe(NON_VOTING_SPANS);
        expect(unmeasured?.metric_values).toEqual([]);
      });
    });

    describe("when a search filter keeps only some of the traces", () => {
      const filterWhere = {
        sql: "TraceName = {scopeTraceName:String}",
        params: { scopeTraceName: "in-scope" },
      };
      const expected = expectedOver((i) => inScope(traceIndexOf(i)));

      /** @scenario Event metric values follow the same trace filter as the event name counts */
      it("counts event names over the filtered traces only", async () => {
        const rows = await runFacet({}, filterWhere);

        expect(Object.fromEntries(rows.map((r) => [r.facet_value, Number(r.cnt)]))).toEqual(
          expected.names,
        );
      });

      /** @scenario Event metric values follow the same trace filter as the event name counts */
      it("buckets vote values over the filtered traces only", async () => {
        const rows = await runFacet({}, filterWhere);
        const buckets = rows
          .find((r) => r.facet_value === VOTE_EVENT)
          ?.metric_values.map(([key, count]) => [key, Number(count)]);

        // Some votes fall outside the filter, so an unscoped bucket would count more.
        expect(expected.up + expected.down).toBeLessThan(VOTING_SPANS);
        expect(buckets).toEqual(
          [
            [`${VOTE_KEY}${EVENT_METRIC_SEP}-1`, expected.down],
            [`${VOTE_KEY}${EVENT_METRIC_SEP}1`, expected.up],
          ].toSorted((a, b) => Number(b[1]) - Number(a[1])),
        );
      });
    });

    describe("when the memory budget is too tight to read every payload value", () => {
      /** @scenario The Event name section loads when events carry large payloads */
      it("still completes with the full answer", async () => {
        const rows = await runFacet({ max_memory_usage: MEMORY_CAP });

        expect(rows).toHaveLength(5);
        expect(rows.find((r) => r.facet_value === VOTE_EVENT)?.metric_values).toHaveLength(2);
      });

      /** @scenario The Event name section loads when events carry large payloads */
      it("exceeds the same budget with the single-pass shape it replaced", async () => {
        const former = forTenant({
          sql: formerSinglePassSql(facetQueries.buildTimeWhere("StartTime")),
          params: facetQueries.baseParams(ctx),
        });

        await expect(
          ch
            .query({
              query: former.sql,
              query_params: former.params,
              format: "JSONEachRow",
              clickhouse_settings: { max_memory_usage: MEMORY_CAP },
            })
            .then((r) => r.json()),
        ).rejects.toThrow(/memory limit exceeded/i);
      });
    });
  });
});
