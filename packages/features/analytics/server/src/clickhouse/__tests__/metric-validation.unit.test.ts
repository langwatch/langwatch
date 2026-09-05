/**
 * A caller-supplied metric reaches the ClickHouse SELECT list as an alias and, before this guard, as a `count() AS <alias>` fallback for any key the
 * translator had no expression for. These tests build the real SQL and assert the injected text is absent from every string the builder emits.
 * @see specs/analytics/timeseries-metric-validation.feature
 */

import { describe, expect, it } from "vitest";
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { KNOWN_METRIC_KEYS, buildMetricAlias, translateMetric } from "../metric-translator";

const INJECTION = "x, (SELECT groupArray(TenantId) FROM trace_summaries) AS leak, 1 -- ";

const timeseriesInput = (series: { metric: string; aggregation: string; key?: string }[]) => ({
  projectId: "test-project",
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-02T00:00:00Z"),
  previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
  series: series.map((s) => ({
    ...s,
    metric: s.metric as AnalyticsSeries["metric"],
    aggregation: s.aggregation as AnalyticsSeries["aggregation"],
  })),
  timeScale: 60,
});

const handledCodeOf = (build: () => unknown): string => {
  try {
    build();
  } catch (error) {
    if (error instanceof HandledError) return error.code;
    throw error;
  }
  throw new Error("expected the build to refuse");
};

const fieldErrorsOf = (build: () => unknown): Record<string, unknown> => {
  try {
    build();
  } catch (error) {
    if (error instanceof HandledError) {
      return (error.meta.fieldErrors ?? {}) as Record<string, unknown>;
    }
    throw error;
  }
  throw new Error("expected the build to refuse");
};

describe("analytics timeseries metric validation", () => {
  describe("given a series naming an enumerated metric", () => {
    describe("when the timeseries query is built", () => {
      /** @scenario "A known metric compiles to its ClickHouse expression" */
      it("selects that metric's aggregate expression", () => {
        const built = buildTimeseriesQuery(
          timeseriesInput([{ metric: "performance.total_cost", aggregation: "sum" }]),
        );

        expect(built.sql).toContain("sum(ts.TotalCost)");
        expect(built.sql).toContain("0__performance_total_cost__sum");
      });

      /** @scenario "A known metric compiles to its ClickHouse expression" */
      it("keeps every metric the browser registry can ask for inside the known set", () => {
        for (const metric of [
          "metadata.trace_id",
          "metadata.user_id",
          "metadata.thread_id",
          "metadata.span_type",
          "sentiment.thumbs_up_down",
          "performance.completion_time",
          "performance.tokens_per_second",
          "evaluations.evaluation_score",
          "evaluations.evaluation_runs",
          "events.event_type",
          "threads.average_duration_per_thread",
        ]) {
          expect(KNOWN_METRIC_KEYS.has(metric)).toBe(true);
        }
      });
    });
  });

  describe("given a series naming a metric the translator has no expression for", () => {
    describe("when the timeseries query is built", () => {
      /** @scenario "An unknown metric is refused as a validation error naming its series" */
      it("refuses with the validation error code", () => {
        expect(
          handledCodeOf(() =>
            buildTimeseriesQuery(
              timeseriesInput([{ metric: "not_a_real_metric", aggregation: "sum" }]),
            ),
          ),
        ).toBe("validation_error");
      });

      /** @scenario "An unknown metric is refused as a validation error naming its series" */
      it("names the metric field of the offending series", () => {
        const fieldErrors = fieldErrorsOf(() =>
          buildTimeseriesQuery(
            timeseriesInput([
              { metric: "performance.total_cost", aggregation: "sum" },
              { metric: "not_a_real_metric", aggregation: "sum" },
            ]),
          ),
        );

        expect(Object.keys(fieldErrors)).toEqual(["series.1.metric"]);
      });

      /** @scenario "An unknown metric is refused as a validation error naming its series" */
      it("refuses a pipeline series on the same enumeration", () => {
        expect(handledCodeOf(() => translateMetric("not_a_real_metric", "sum", 0))).toBe(
          "validation_error",
        );
      });
    });
  });

  describe("given a series whose metric carries a subquery and a comment terminator", () => {
    describe("when the timeseries query is built", () => {
      /** @scenario "Injected SQL in a metric name never reaches the built query" */
      it("refuses with the validation error code", () => {
        expect(
          handledCodeOf(() =>
            buildTimeseriesQuery(timeseriesInput([{ metric: INJECTION, aggregation: "sum" }])),
          ),
        ).toBe("validation_error");
      });

      /** @scenario "Injected SQL in a metric name never reaches the built query" */
      it("emits no SQL carrying the injected text", () => {
        let sql: string | undefined;
        try {
          sql = buildTimeseriesQuery(
            timeseriesInput([{ metric: INJECTION, aggregation: "sum" }]),
          ).sql;
        } catch {
          sql = undefined;
        }

        expect(sql).toBeUndefined();
      });

      /** @scenario "Injected SQL in a metric name never reaches the built query" */
      it("keeps the injected text out of a query built around a legitimate series", () => {
        const built = buildTimeseriesQuery(
          timeseriesInput([{ metric: "performance.total_cost", aggregation: "sum" }]),
        );

        expect(built.sql).not.toContain("groupArray(TenantId)");
        expect(built.sql).not.toContain("leak");
        expect(built.sql).not.toContain("--");
      });
    });
  });

  describe("given alias parts carrying punctuation", () => {
    describe("when the alias is built", () => {
      /** @scenario "Every part of a metric alias is reduced to letters, digits and underscores" */
      it("reduces every part to letters, digits and underscores", () => {
        const alias = buildMetricAlias(0, INJECTION, "sum", "key-with-dashes'", "sub key)");

        expect(alias).toMatch(/^[a-zA-Z0-9_]+$/);
        for (const metacharacter of ["(", ")", ",", "'", '"', "-", " ", "."]) {
          expect(alias).not.toContain(metacharacter);
        }
      });
    });
  });

  describe("given a series whose evaluator key carries a quote and a comment terminator", () => {
    describe("when the timeseries query is built", () => {
      /** @scenario "A series key reaches the query only as a bound parameter" */
      it("binds the key as a parameter and never writes it into the SQL", () => {
        const hostileKey = "eval-1' OR 1=1 -- ";
        const built = buildTimeseriesQuery(
          timeseriesInput([
            {
              metric: "evaluations.evaluation_score",
              aggregation: "avg",
              key: hostileKey,
            },
          ]),
        );

        expect(built.sql).not.toContain(hostileKey);
        expect(built.sql).not.toContain("OR 1=1");
        expect(Object.values(built.params)).toContain(hostileKey);
      });
    });
  });
});
