/**
 * Span type reads from span_analytics against the stored_spans map they replace: the same
 * answers, and the map read is the one a memory cap refuses.
 * @see specs/analytics/span-type-light-reads.feature
 * @integration
 * @vitest-environment node
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import type { SpanAnalyticsFloor } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  releaseMigratedCaches,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import {
  clickHouseQueryClientOver,
  ownProjectReaderOver,
} from "./support/clickhouse-query-client.support.ts";

const TENANT_ID = `span-type-light-${nanoid(8)}`;
const SEEDED_TABLES = ["trace_summaries", "stored_spans", "span_analytics"] as const;
const TRACES = 4_000;
const SPANS_PER_TRACE = 6;
const SEED_SLICE = 6_000;
const DAY_MS = 86_400_000;
/** Traces start one every 10 minutes from here, so 4,000 of them cover about 28 days. */
const FIRST_TRACE = "2026-09-01 00:00:00";
const FIRST_TRACE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const PREVIOUS_START = new Date(FIRST_TRACE_MS + 6 * DAY_MS);
const CURRENT_START = new Date(FIRST_TRACE_MS + 14 * DAY_MS);
const CURRENT_END = new Date(FIRST_TRACE_MS + 22 * DAY_MS);
const SPAN_TYPES = ["llm", "tool", "agent", "rag", "chain", ""];

const FLOORS: Record<string, SpanAnalyticsFloor | null> = {
  stored_spans: null,
  "span_analytics alone": { from: null, rebuilding: false },
  "split at the floor": {
    from: new Date(FIRST_TRACE_MS + 12 * DAY_MS).toISOString(),
    rebuilding: false,
  },
};

/** The cap the memory test reads under, between what the two reads peak at on four threads. */
const MEMORY_CAP_BYTES = "20000000";

const traceCount: AnalyticsSeries[] = [{ metric: "metadata.trace_id", aggregation: "cardinality" }];

function timeseries({
  floor,
  filters,
  groupBy,
}: {
  floor: SpanAnalyticsFloor | null;
  filters?: Record<string, string[]>;
  groupBy?: string;
}) {
  resetParamCounter();
  return buildTimeseriesQuery({
    projectId: TENANT_ID,
    previousPeriodStartDate: PREVIOUS_START,
    startDate: CURRENT_START,
    endDate: CURRENT_END,
    timeScale: "full",
    series: traceCount,
    ...(filters ? { filters } : {}),
    ...(groupBy ? { groupBy } : {}),
    spanAnalyticsFloor: floor,
  });
}

async function readRows({
  client,
  sql,
  params,
  settings,
}: {
  client: ClickHouseClient;
  sql: string;
  params: Record<string, unknown>;
  settings?: Record<string, string | number>;
}): Promise<Record<string, unknown>[]> {
  const result = await ownProjectReaderOver({ client, projectId: TENANT_ID }).query<
    Record<string, unknown>
  >({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    ...(settings ? { clickhouse_settings: settings } : {}),
  });
  return result.json();
}

/** Rows in a stable order, every value as text, so two reads compare whole. */
function canonical(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => JSON.stringify(row, Object.keys(row).toSorted())).toSorted();
}

describe("given spans stored in both stored_spans and span_analytics", () => {
  let client: ClickHouseClient;

  beforeAll(async () => {
    client = (await startMigratedClickHouse()).client;
    await releaseMigratedCaches(client);
    const settings = { max_threads: 1, max_insert_threads: "1", max_block_size: "4096" };
    const spans = TRACES * SPANS_PER_TRACE;
    // Seeded in slices: one insert of every generated map passes the 1 GiB a CI server allows.
    for (let start = 0; start < spans; start += SEED_SLICE) {
      await client.command({
        query: `INSERT INTO stored_spans (ProjectionId, TenantId, TraceId, SpanId, StartTime, EndTime,
            DurationMs, SpanName, SpanKind, ServiceName, ResourceAttributes, SpanAttributes, StatusCode,
            ScopeName, CreatedAt, UpdatedAt)
          SELECT 'p', {tenant:String}, concat('trace-', toString(intDiv(number, ${SPANS_PER_TRACE}))),
            concat('span-', toString(number)),
            toDateTime64('${FIRST_TRACE}', 3) + toIntervalSecond(intDiv(number, ${SPANS_PER_TRACE}) * 600 + number % ${SPANS_PER_TRACE}),
            toDateTime64('${FIRST_TRACE}', 3) + toIntervalSecond(intDiv(number, ${SPANS_PER_TRACE}) * 600 + number % ${SPANS_PER_TRACE} + 1),
            1000, 'op', 1, 'svc', map(),
            CAST(map(
              'langwatch.span.type', [${SPAN_TYPES.map((type) => `'${type}'`).join(", ")}][(number * 7 + intDiv(number, ${SPANS_PER_TRACE})) % ${SPAN_TYPES.length} + 1],
              'langwatch.input', randomPrintableASCII(1500),
              'langwatch.output', randomPrintableASCII(1500)
            ) AS Map(LowCardinality(String), String)),
            1, 'scope', now64(3), now64(3)
          FROM numbers(${start}, ${SEED_SLICE})`,
        query_params: { tenant: TENANT_ID },
        clickhouse_settings: settings,
      });
    }
    await client.command({
      query: `INSERT INTO span_analytics (TenantId, TraceId, SpanId, StartTime, EndTime, DurationMs,
          SpanName, SpanKind, StatusCode, SpanType, ProjectedAt)
        SELECT TenantId, TraceId, SpanId, StartTime, EndTime, DurationMs, SpanName, SpanKind,
          StatusCode, SpanAttributes['langwatch.span.type'], now64(3)
        FROM stored_spans WHERE TenantId = {tenant:String}`,
      query_params: { tenant: TENANT_ID },
      clickhouse_settings: settings,
    });
    await client.command({
      query: `INSERT INTO trace_summaries (ProjectionId, TenantId, TraceId, Version, Attributes,
          OccurredAt, CreatedAt, UpdatedAt, ComputedIOSchemaVersion, TotalDurationMs, SpanCount,
          ContainsErrorStatus, ContainsOKStatus, Models, TokensEstimated, TotalCost)
        SELECT 'p', {tenant:String}, concat('trace-', toString(number)), 'v1', map(),
          toDateTime64('${FIRST_TRACE}', 3) + toIntervalSecond(number * 600), now64(3), now64(3), 'v1',
          1000, ${SPANS_PER_TRACE}, 0, 1, ['gpt-5'], 0, 0.01
        FROM numbers(${TRACES})`,
      query_params: { tenant: TENANT_ID },
    });
  }, 300_000);

  afterAll(async () => {
    await deleteMigratedTenantRows({ client, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  });

  describe("when a dashboard filters and groups by span type and the picker lists span types", () => {
    /** @scenario "Span type reads from span_analytics give what stored_spans gives" */
    it("gives the same filtered series from every source", async () => {
      const answers = await Promise.all(
        Object.values(FLOORS).map((floor) =>
          readRows({
            client,
            ...timeseries({ floor, filters: { "spans.type": ["tool", "rag"] } }),
          }),
        ),
      );

      expect(answers[0]!.length).toBeGreaterThan(0);
      for (const answer of answers.slice(1))
        expect(canonical(answer)).toEqual(canonical(answers[0]!));
    });

    /** @scenario "Span type reads from span_analytics give what stored_spans gives" */
    it("gives the same series grouped by span type from every source", async () => {
      const answers = await Promise.all(
        Object.values(FLOORS).map((floor) =>
          readRows({ client, ...timeseries({ floor, groupBy: "metadata.span_type" }) }),
        ),
      );

      expect(answers[0]!.length).toBeGreaterThan(SPAN_TYPES.length);
      for (const answer of answers.slice(1))
        expect(canonical(answer)).toEqual(canonical(answers[0]!));
    });

    /** @scenario "Span type reads from span_analytics give what stored_spans gives" */
    it("gives the same span type options from every source", async () => {
      const repository = FilterOptionsClickHouseRepository.create({
        clickhouse: clickHouseQueryClientOver(client),
      });
      const answers = await Promise.all(
        Object.values(FLOORS).map((floor) =>
          repository.findOptions({
            field: "spans.type",
            authorization: analyticsProof({ projectId: TENANT_ID }),
            startDate: PREVIOUS_START.getTime(),
            endDate: CURRENT_END.getTime(),
            spanAnalyticsFloor: floor,
          }),
        ),
      );

      expect(answers[0]!.map((option) => option.field).toSorted()).toEqual(
        SPAN_TYPES.filter(Boolean).toSorted(),
      );
      for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    });
  });

  describe("when traces are filtered by span type under a memory cap", () => {
    const capped = { max_memory_usage: MEMORY_CAP_BYTES, max_threads: 4 };

    /** @scenario "A span type filter over heavy attribute maps stays under a memory cap" */
    it("refuses the stored_spans map read", async () => {
      await releaseMigratedCaches(client);
      const built = timeseries({ floor: null, filters: { "spans.type": ["tool"] } });

      await expect(readRows({ client, ...built, settings: capped })).rejects.toMatchObject({
        type: "MEMORY_LIMIT_EXCEEDED",
      });
    });

    /** @scenario "A span type filter over heavy attribute maps stays under a memory cap" */
    it("answers the span_analytics read", async () => {
      await releaseMigratedCaches(client);
      const built = timeseries({
        floor: { from: null, rebuilding: false },
        filters: { "spans.type": ["tool"] },
      });

      await expect(readRows({ client, ...built, settings: capped })).resolves.toEqual(
        expect.any(Array),
      );
    });
  });
});
