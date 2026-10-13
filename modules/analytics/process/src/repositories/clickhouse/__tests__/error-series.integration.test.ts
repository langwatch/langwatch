/**
 * Per-series filters and percentage mode (#6718), executed against seeded data: SQL shape
 * lives in `aggregation-builder.test.ts`, and a different shape is not right numbers.
 * @see specs/analytics/error-series.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import {
  EMPTY_WINDOW,
  ERROR_TRACES_MIN_DURATION_MS,
  EVALUATED,
  EVALUATED_WITH_ERROR,
  evaluationRunRow,
  storedSpanRow,
  TENANT_ID,
  TRACES,
  TRACES_TOTAL,
  TRACES_WITH_ERROR,
  traceCount,
  traceSummaryRow,
  WINDOW,
} from "./error-series.fixture.ts";

const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;

describe("per-series filters and percentage mode", () => {
  let ch: ClickHouseClient;

  /** Run a built query and return the row tagged as the current period. */
  const runCurrent = async (
    input: Parameters<typeof buildTimeseriesQuery>[0],
  ): Promise<Record<string, number | string>[]> => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery(input);
    const result = await ch.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, number | string>>();
    return rows.filter((row) => row.period === "current");
  };

  const numberAt = (row: Record<string, number | string> | undefined, alias: string): number =>
    Number(row?.[alias] ?? 0);

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    await deleteTenantRows();

    await ch.insert({
      table: "trace_summaries",
      values: TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "stored_spans",
      values: TRACES.map(storedSpanRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "evaluation_runs",
      values: EVALUATED.map(evaluationRunRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    await deleteTenantRows();
  });

  async function deleteTenantRows(): Promise<void> {
    await deleteMigratedTenantRows({ client: ch, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  }

  describe("given a graph with an errors series and a no-errors series", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "The with-errors and without-errors series partition the window" */
      it("reports different counts that add up to every trace in the window", async () => {
        const [withErrors, withoutErrors] = [traceCount(0), traceCount(1)];
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            { ...withErrors, filters: { "traces.error": ["true"] } },
            { ...withoutErrors, filters: { "traces.error": ["false"] } },
          ],
        });

        const errors = numberAt(rows[0], withErrors.alias);
        const nonErrors = numberAt(rows[0], withoutErrors.alias);

        expect(errors).toBe(TRACES_WITH_ERROR);
        expect(nonErrors).toBe(TRACES_TOTAL - TRACES_WITH_ERROR);
        expect(errors).not.toBe(nonErrors);
        expect(errors + nonErrors).toBe(TRACES_TOTAL);
      });

      /** @scenario "An alert on the error series counts only traces with errors" */
      it("counts only the traces that contain an error", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          series: [{ ...series, filters: { "traces.error": ["true"] } }],
        });

        expect(numberAt(rows[0], series.alias)).toBe(TRACES_WITH_ERROR);
      });
    });
  });

  describe("given a graph with one series filtered by span type", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "A filter that reads span data still applies to its own series only" */
      it("narrows only the filtered series", async () => {
        const [filtered, unfiltered] = [traceCount(0), traceCount(1)];
        const rows = await runCurrent({
          ...WINDOW,
          series: [{ ...filtered, filters: { "spans.type": ["llm"] } }, unfiltered],
        });

        const tracesWithLlmSpan = TRACES.filter((trace) => trace.spanType === "llm").length;
        expect(numberAt(rows[0], filtered.alias)).toBe(tracesWithLlmSpan);
        expect(numberAt(rows[0], unfiltered.alias)).toBe(TRACES_TOTAL);
      });
    });
  });

  describe("given a filtered series shown as a percentage", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "Percentage mode divides the filtered series by the unfiltered series" */
      it("reports the share of traces in the window that contain an error", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            {
              ...series,
              filters: { "traces.error": ["true"] },
              asPercent: true,
            },
          ],
        });

        expect(numberAt(rows[0], series.alias)).toBeCloseTo(
          (TRACES_WITH_ERROR / TRACES_TOTAL) * 100,
          6,
        );
      });
    });

    describe("when the window holds no traces", () => {
      /** @scenario "Percentage mode reports zero when the window holds no traces" */
      it("reports zero rather than no value at all", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...EMPTY_WINDOW,
          series: [
            {
              ...series,
              filters: { "traces.error": ["true"] },
              asPercent: true,
            },
          ],
        });

        expect(rows.length).toBeGreaterThan(0);
        expect(numberAt(rows[0], series.alias)).toBe(0);
      });
    });
  });

  // The grouped path aggregates OUTSIDE the scan, over a CTE without the `ts` alias, so
  // the predicate rides as a hoisted per-trace boolean; only executing it proves the hoist.
  describe("given a grouped graph with one filtered and one unfiltered series", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "A per-series filter narrows its series on a grouped graph" */
      it("narrows only the filtered series within every group", async () => {
        const [filtered, unfiltered] = [traceCount(0), traceCount(1)];
        const rows = await runCurrent({
          ...WINDOW,
          timeScale: 1440,
          groupBy: "metadata.span_type",
          series: [{ ...filtered, filters: { "traces.error": ["true"] } }, unfiltered],
        });

        const totals = new Map<string, { filtered: number; all: number }>();
        for (const row of rows) {
          const key = String(row.group_key);
          const running = totals.get(key) ?? { filtered: 0, all: 0 };
          running.filtered += numberAt(row, filtered.alias);
          running.all += numberAt(row, unfiltered.alias);
          totals.set(key, running);
        }

        const expected = (spanType: string, hasError?: boolean) =>
          TRACES.filter(
            (trace) =>
              trace.spanType === spanType &&
              (hasError === undefined || trace.hasError === hasError),
          ).length;

        expect(totals.get("llm")).toEqual({
          filtered: expected("llm", true),
          all: expected("llm"),
        });
        expect(totals.get("agent")).toEqual({
          filtered: expected("agent", true),
          all: expected("agent"),
        });
      });
    });
  });

  // Mixing an evaluation metric with a trace metric pre-aggregates per trace to undo the
  // evaluation-run fan-out; it carries the same hoisted boolean, the likeliest wrong row.
  describe("given a graph pairing an evaluation score with a filtered trace count", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "A per-series filter narrows its series alongside an evaluation measurement" */
      it("counts only traces with an error and leaves the score alone", async () => {
        const [filtered, unfiltered] = [traceCount(1), traceCount(2)];
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            {
              metric: "evaluations.evaluation_score",
              aggregation: "avg" as const,
            },
            { ...filtered, filters: { "traces.error": ["true"] } },
            unfiltered,
          ],
        });

        const averageScore =
          EVALUATED.reduce((total, evaluated) => total + evaluated.score, 0) / EVALUATED.length;

        expect(numberAt(rows[0], filtered.alias)).toBe(EVALUATED_WITH_ERROR);
        // EVALUATED.length, not TRACES_TOTAL: the evaluations series inner-joins
        // `evaluation_runs` (buildJoinClause), dropping unevaluated traces first, so
        // reading short of the window's trace count is the join working.
        expect(numberAt(rows[0], unfiltered.alias)).toBe(EVALUATED.length);
        expect(numberAt(rows[0], "0__evaluations_evaluation_score__avg")).toBeCloseTo(
          averageScore,
          6,
        );
      });
    });
  });

  describe("given a filtered series whose aggregation is not additive", () => {
    describe("when the window holds traces but the filter matches none", () => {
      /** @scenario "A filtered average or extremum reports no value when nothing matched" */
      it("reports no value rather than a duration of zero", async () => {
        const alias = "0__performance_completion_time__min";
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            {
              metric: "performance.completion_time",
              aggregation: "min" as const,
              filters: { "spans.type": ["no-span-type-matches-this"] },
            },
          ],
        });

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]?.[alias] ?? null).toBeNull();
      });
    });

    describe("when the filter does match traces", () => {
      it("still reports the real measurement", async () => {
        const alias = "0__performance_completion_time__min";
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            {
              metric: "performance.completion_time",
              aggregation: "min" as const,
              filters: { "traces.error": ["true"] },
            },
          ],
        });

        // The error traces run longer than the clean ones, so this reads the
        // window-wide minimum instead if the series filter is dropped.
        expect(numberAt(rows[0], alias)).toBe(ERROR_TRACES_MIN_DURATION_MS);
      });
    });
  });

  describe("given a graph grouped by whether the trace contains an error", () => {
    describe("when the graph is queried over a window", () => {
      /** @scenario "Grouping by error status puts each trace in exactly one bucket" */
      it("puts each trace in exactly one bucket", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          timeScale: 1440,
          groupBy: "error.has_error",
          series: [series],
        });

        const buckets = new Map<string, number>();
        for (const row of rows) {
          const key = String(row.group_key);
          buckets.set(key, (buckets.get(key) ?? 0) + numberAt(row, series.alias));
        }

        expect(buckets.get("with error")).toBe(TRACES_WITH_ERROR);
        expect(buckets.get("without error")).toBe(TRACES_TOTAL - TRACES_WITH_ERROR);
        expect([...buckets.values()].reduce((a, b) => a + b, 0)).toBe(TRACES_TOTAL);
      });
    });
  });
});
