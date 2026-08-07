/**
 * The advisory diagnostics: which shapes earn one, and which do not.
 *
 * Driven through the real validator rather than through hand-built blocks. The
 * whole design of the shape rules is that they read what the *single* parser
 * pass recorded, so a suite that fabricated its own blocks would be testing an
 * agreement between two pieces of this test file and would stay green if the
 * walk stopped recording the fact.
 *
 * Every "fires" case is paired with a "does not fire" control that differs by
 * exactly the fact under test — a diagnostic that fired on everything would
 * pass every positive case here and be worthless in a response.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import { describe, expect, it } from "vitest";

import { GOVERNED_VIEW_CATALOG } from "../catalog/governedViews";
import { governedAllowedTables } from "../catalog/types";
import {
  GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING,
  GOVERNED_SQL_DIAGNOSTIC_CODES,
  type GovernedSqlDiagnostic,
  governedSqlDiagnostics,
} from "../diagnostics";
import type { GovernedSqlColumn } from "../executor";
import { DEFAULT_GOVERNED_SQL_RESULT_LIMITS } from "../executor";
import { validateGovernedSql } from "../validation/validate";

const DATABASE = "analytics";

/** Nothing is withheld: these cases are about shape, never about permissions. */
const NO_GATED_COLUMNS: readonly string[] = [];

/** Well after every timestamp the fixtures use, so no period is unfinished. */
const LONG_AFTER = new Date("2026-06-01T00:00:00Z");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Runs the shipped validator, then the diagnostics, over a submitted statement
 * and a result the caller describes.
 *
 * Fails loudly on a statement the validator refuses: a typo would otherwise
 * produce an empty block list and every "no diagnostic" assertion would pass.
 */
function diagnose({
  sql,
  columns = [],
  rows = [],
  truncated = false,
  now = LONG_AFTER,
}: {
  sql: string;
  columns?: readonly GovernedSqlColumn[];
  rows?: readonly Record<string, unknown>[];
  truncated?: boolean;
  now?: Date;
}): readonly GovernedSqlDiagnostic[] {
  const validation = validateGovernedSql({
    sql,
    allowedTables: governedAllowedTables({
      database: DATABASE,
      views: GOVERNED_VIEW_CATALOG,
    }),
    gatedColumns: NO_GATED_COLUMNS,
    defaultDatabase: DATABASE,
  });
  if (!validation.ok) {
    throw new Error(
      `the fixture SQL was refused by the validator: ${validation.violations
        .map((violation) => `${violation.code} ${violation.message}`)
        .join(" | ")}\n${sql}`,
    );
  }
  return governedSqlDiagnostics({
    validation,
    database: DATABASE,
    views: GOVERNED_VIEW_CATALOG,
    columns,
    rows,
    truncated,
    limits: DEFAULT_GOVERNED_SQL_RESULT_LIMITS,
    rowsReturned: rows.length,
    now,
  });
}

const codesOf = (diagnostics: readonly GovernedSqlDiagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.code);

const find = (
  diagnostics: readonly GovernedSqlDiagnostic[],
  code: (typeof GOVERNED_SQL_DIAGNOSTIC_CODES)[number],
) => diagnostics.find((diagnostic) => diagnostic.code === code);

/** A bounded read of one dataset: the shape every control below starts from. */
const BOUNDED_TRACES =
  "SELECT TraceId, TotalDurationMs FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)";

/** Hourly buckets as ClickHouse's JSON encoding writes a `DateTime`. */
function hourlyBucket(isoHour: string): Record<string, unknown> {
  return { bucket: isoHour, calls: 1 };
}

const BUCKET_COLUMNS: readonly GovernedSqlColumn[] = [
  { name: "bucket", type: "DateTime" },
  { name: "calls", type: "UInt64" },
];

/** A time-bucketed query, so the result rules have something to read. */
const BUCKETED_TRACES =
  "SELECT toStartOfHour(OccurredAt) AS bucket, count() AS calls " +
  "FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-20 10:00:00', 3) " +
  "GROUP BY bucket ORDER BY bucket";

describe("given a governed query that ran", () => {
  describe("when nothing about it is suspect", () => {
    it("reports no diagnostic at all", () => {
      expect(codesOf(diagnose({ sql: BOUNDED_TRACES }))).toEqual([]);
    });

    /**
     * The documented meaning of that empty list, held against the words rather
     * than against the constant: a test that read the sentence out of the
     * module it guards could never disagree with it.
     */
    /** @scenario "Clean diagnostic status is documented as no known issue detected" */
    it("documents the empty list as no known issue detected, never as proof", () => {
      expect(GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING).toContain(
        "no known issue was detected",
      );
      expect(GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING).toContain("not proof");
      for (const overclaim of ["guarantee", "correct", "verified", "proves"]) {
        expect(
          GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING.toLowerCase(),
          `the clean status claims to be ${overclaim}`,
        ).not.toContain(overclaim);
      }
    });
  });

  describe("when a response ceiling cut the result short", () => {
    it("names the ceiling and how many rows survived it", () => {
      const diagnostics = diagnose({
        sql: BOUNDED_TRACES,
        rows: [{ TraceId: "a" }, { TraceId: "b" }],
        truncated: true,
      });

      expect(codesOf(diagnostics)).toEqual(["RESULT_TRUNCATED"]);
      expect(find(diagnostics, "RESULT_TRUNCATED")!.meta).toMatchObject({
        maxRows: DEFAULT_GOVERNED_SQL_RESULT_LIMITS.maxRows,
        rowsReturned: 2,
      });
    });
  });

  describe("when a join widens the grain", () => {
    it("names the repeated dataset, its measures, and the key the join left unmatched", () => {
      const diagnostics = diagnose({
        sql:
          "SELECT t.TraceId, sum(t.TotalDurationMs) AS total " +
          "FROM analytics.traces AS t " +
          "INNER JOIN analytics.spans AS s ON s.TraceId = t.TraceId " +
          "WHERE t.OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3) " +
          "AND s.StartTime >= toDateTime64('2026-02-16 00:00:00', 3) " +
          "GROUP BY t.TraceId",
      });

      const fanout = find(diagnostics, "POSSIBLE_FANOUT");
      expect(codesOf(diagnostics)).toEqual(["POSSIBLE_FANOUT"]);
      expect(fanout!.meta).toMatchObject({
        dataset: "analytics.traces",
        multipliedBy: "analytics.spans",
        unmatchedGrainColumns: ["SpanId"],
        aggregated: true,
      });
      // The affected columns are the repeated dataset's measures — the ones
      // where the repetition changes the number rather than only the row count.
      expect(fanout!.meta!.affectedColumns).toContain("TotalDurationMs");
      expect(fanout!.meta!.affectedColumns).toContain("TotalCost");
      expect(fanout!.meta!.affectedColumns).not.toContain("TraceId");
      // One direction only: a span matches exactly one trace, so the trace side
      // multiplies nothing.
      expect(diagnostics).toHaveLength(1);
    });

    it("says nothing when the join matches the finer dataset's whole grain", () => {
      expect(
        codesOf(
          diagnose({
            sql:
              "SELECT a.SpanId, count() AS n FROM analytics.spans AS a " +
              "INNER JOIN analytics.spans AS b " +
              "ON b.TraceId = a.TraceId AND b.SpanId = a.SpanId " +
              "WHERE a.StartTime >= toDateTime64('2026-02-16 00:00:00', 3) " +
              "AND b.StartTime >= toDateTime64('2026-02-16 00:00:00', 3) " +
              "GROUP BY a.SpanId",
          }),
        ),
      ).toEqual([]);
    });

    it("reports the bare select over the same join too, saying rows rather than measures repeat", () => {
      const fanout = find(
        diagnose({
          sql:
            "SELECT t.TraceId, s.SpanName FROM analytics.traces AS t " +
            "INNER JOIN analytics.spans AS s ON s.TraceId = t.TraceId " +
            "WHERE t.OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3) " +
            "AND s.StartTime >= toDateTime64('2026-02-16 00:00:00', 3)",
        }),
        "POSSIBLE_FANOUT",
      );

      expect(fanout!.meta).toMatchObject({ aggregated: false });
      expect(fanout!.message).toContain("rows are therefore repeated");
    });

    /**
     * The tenant column is equal on both sides whether or not the caller wrote
     * it, because the row policy resolves one tenant for the query. Without
     * that, every ordinary child-to-parent join would report the parent as
     * fanning out the child.
     */
    it("treats a join that matches everything but the tenant as covered", () => {
      const diagnostics = diagnose({
        sql:
          "SELECT e.EvaluationId, t.TraceName FROM analytics.evaluations AS e " +
          "INNER JOIN analytics.traces AS t ON t.TraceId = e.TraceId " +
          "WHERE e.ScheduledAt >= toDateTime64('2026-02-16 00:00:00', 3) " +
          "AND t.OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)",
      });

      // Only one direction: evaluations repeat a trace, a trace never repeats
      // an evaluation.
      expect(diagnostics.map((diagnostic) => diagnostic.meta?.dataset)).toEqual(
        ["analytics.traces"],
      );
    });

    it("stays quiet when the datasets are joined through a common table expression it cannot resolve", () => {
      // Documented under-reporting: the walk records the join's equalities, and
      // one side of this one names a `WITH` alias rather than a dataset. A rule
      // that guessed would be inventing the grain it reports.
      expect(
        codesOf(
          diagnose({
            sql:
              "WITH recent AS (SELECT TraceId FROM analytics.traces " +
              "WHERE OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)) " +
              "SELECT count() AS n FROM recent AS r " +
              "INNER JOIN analytics.spans AS s ON s.TraceId = r.TraceId " +
              "WHERE s.StartTime >= toDateTime64('2026-02-16 00:00:00', 3)",
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("when a dataset is read with no condition on its time column", () => {
    it("names the dataset and the column that would bound the read", () => {
      const diagnostics = diagnose({
        sql: "SELECT count() AS n FROM analytics.traces",
      });

      expect(codesOf(diagnostics)).toEqual(["UNBOUNDED_TIME_RANGE"]);
      expect(find(diagnostics, "UNBOUNDED_TIME_RANGE")!.meta).toEqual({
        dataset: "analytics.traces",
        timeColumn: "OccurredAt",
      });
    });

    it("reports each unbounded dataset once, and not the bounded one beside it", () => {
      const diagnostics = diagnose({
        sql:
          "SELECT count() AS n FROM analytics.traces AS t " +
          "INNER JOIN analytics.spans AS s " +
          "ON s.TraceId = t.TraceId AND s.SpanId = t.TraceId " +
          "WHERE t.OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)",
      });

      expect(
        diagnostics
          .filter((diagnostic) => diagnostic.code === "UNBOUNDED_TIME_RANGE")
          .map((diagnostic) => diagnostic.meta?.dataset),
      ).toEqual(["analytics.spans"]);
    });

    it("counts a condition written inside a common table expression as bounding it", () => {
      expect(
        codesOf(
          diagnose({
            sql:
              "WITH recent AS (SELECT TraceId FROM analytics.traces " +
              "WHERE OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)) " +
              "SELECT count() AS n FROM recent",
          }),
        ),
      ).toEqual([]);
    });

    it("counts a bound parameter in the condition as bounding it", () => {
      expect(
        codesOf(
          diagnose({
            sql:
              "SELECT count() AS n FROM analytics.traces " +
              "WHERE OccurredAt >= {since:DateTime64(3)}",
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("when a time-bucketed result skips buckets inside its range", () => {
    it("counts the empty buckets and says where the gaps are", () => {
      const diagnostics = diagnose({
        sql: BUCKETED_TRACES,
        columns: BUCKET_COLUMNS,
        rows: [
          hourlyBucket("2026-02-20 10:00:00"),
          hourlyBucket("2026-02-20 11:00:00"),
          // 12:00 and 13:00 have no rows.
          hourlyBucket("2026-02-20 14:00:00"),
        ],
      });

      expect(codesOf(diagnostics)).toEqual(["MISSING_TIME_BUCKETS"]);
      expect(find(diagnostics, "MISSING_TIME_BUCKETS")!.meta).toMatchObject({
        timeColumn: "bucket",
        missingBucketCount: 2,
        bucketMs: HOUR_MS,
        gapsAfter: ["2026-02-20T11:00:00.000Z"],
      });
    });

    it("says nothing when every bucket in the range carries a row", () => {
      expect(
        codesOf(
          diagnose({
            sql: BUCKETED_TRACES,
            columns: BUCKET_COLUMNS,
            rows: [
              hourlyBucket("2026-02-20 10:00:00"),
              hourlyBucket("2026-02-20 11:00:00"),
              hourlyBucket("2026-02-20 12:00:00"),
            ],
          }),
        ),
      ).toEqual([]);
    });

    /**
     * The shape that made the grouping-key condition necessary: "first failure
     * per trace" groups by trace and returns a timestamp *aggregate*, and the
     * ordinary spacing between two unrelated traces is not a series with holes
     * in it.
     */
    it("says nothing about a timestamp the query aggregated rather than bucketed", () => {
      expect(
        codesOf(
          diagnose({
            sql:
              "SELECT TraceId, minIf(StartTime, ifNull(StatusCode, 0) = 2) AS first_failure_at " +
              "FROM analytics.spans " +
              "WHERE StartTime >= toDateTime64('2026-02-20 00:00:00', 3) " +
              "GROUP BY TraceId ORDER BY TraceId",
            columns: [
              { name: "TraceId", type: "String" },
              { name: "first_failure_at", type: "DateTime64(3)" },
            ],
            rows: [
              { TraceId: "a", first_failure_at: "2026-02-20 10:00:01.000" },
              { TraceId: "b", first_failure_at: "2026-02-20 10:00:02.000" },
              { TraceId: "c", first_failure_at: "2026-02-20 10:05:00.000" },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it("says nothing about a query that never bucketed by time", () => {
      // The same rows, from a query that groups nothing: a list of timestamps
      // is not a series, and reporting holes in it would be inventing a shape.
      expect(
        codesOf(
          diagnose({
            sql:
              "SELECT OccurredAt, TraceId FROM analytics.traces " +
              "WHERE OccurredAt >= toDateTime64('2026-02-20 10:00:00', 3)",
            columns: [
              { name: "OccurredAt", type: "DateTime64(3)" },
              { name: "TraceId", type: "String" },
            ],
            rows: [
              { OccurredAt: "2026-02-20 10:00:00.000", TraceId: "a" },
              { OccurredAt: "2026-02-20 11:00:00.000", TraceId: "b" },
              { OccurredAt: "2026-02-20 14:00:00.000", TraceId: "c" },
            ],
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("when the newest bucket has not finished filling", () => {
    it("reports the comparison as unequal, naming the unfinished period", () => {
      const diagnostics = diagnose({
        sql: BUCKETED_TRACES,
        columns: BUCKET_COLUMNS,
        rows: [
          hourlyBucket("2026-02-20 10:00:00"),
          hourlyBucket("2026-02-20 11:00:00"),
          hourlyBucket("2026-02-20 12:00:00"),
        ],
        // Half an hour into the 12:00 bucket, which therefore holds half a
        // period's data against the whole periods before it.
        now: new Date("2026-02-20T12:30:00Z"),
      });

      expect(codesOf(diagnostics)).toEqual(["INCOMPLETE_COMPARISON_PERIOD"]);
      expect(
        find(diagnostics, "INCOMPLETE_COMPARISON_PERIOD")!.meta,
      ).toMatchObject({
        reason: "unfinished_newest_period",
        periodMs: HOUR_MS,
        newestPeriodStart: "2026-02-20T12:00:00.000Z",
      });
    });

    it("says nothing once that period has closed", () => {
      expect(
        codesOf(
          diagnose({
            sql: BUCKETED_TRACES,
            columns: BUCKET_COLUMNS,
            rows: [
              hourlyBucket("2026-02-20 10:00:00"),
              hourlyBucket("2026-02-20 11:00:00"),
              hourlyBucket("2026-02-20 12:00:00"),
            ],
            now: new Date("2026-02-20T13:00:00Z"),
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("when the buckets are not all the same length", () => {
    it("reports the periods as unequal spans of time", () => {
      const diagnostics = diagnose({
        sql: BUCKETED_TRACES,
        columns: BUCKET_COLUMNS,
        rows: [
          hourlyBucket("2026-02-20 10:00:00"),
          hourlyBucket("2026-02-20 11:00:00"),
          hourlyBucket("2026-02-20 13:30:00"),
        ],
      });

      expect(codesOf(diagnostics)).toContain("INCOMPLETE_COMPARISON_PERIOD");
      expect(
        find(diagnostics, "INCOMPLETE_COMPARISON_PERIOD")!.meta,
      ).toMatchObject({ reason: "unequal_periods", unevenPeriodCount: 1 });
    });

    /**
     * A calendar month is not a fixed number of milliseconds. Without a
     * tolerance, `toStartOfMonth` would report itself as misaligned on every
     * result that crosses February.
     */
    it("accepts calendar months, whose lengths genuinely differ", () => {
      expect(
        codesOf(
          diagnose({
            sql:
              "SELECT toStartOfMonth(OccurredAt) AS bucket, count() AS calls " +
              "FROM analytics.traces " +
              "WHERE OccurredAt >= toDateTime64('2026-01-01 00:00:00', 3) " +
              "GROUP BY bucket ORDER BY bucket",
            columns: [
              { name: "bucket", type: "Date" },
              { name: "calls", type: "UInt64" },
            ],
            rows: [
              { bucket: "2026-01-01", calls: 1 },
              { bucket: "2026-02-01", calls: 1 },
              { bucket: "2026-03-01", calls: 1 },
            ],
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("when several things are worth reading twice at once", () => {
    it("carries every one of them, truncation first", () => {
      const diagnostics = diagnose({
        sql:
          "SELECT toStartOfHour(t.OccurredAt) AS bucket, sum(t.TotalDurationMs) AS total " +
          "FROM analytics.traces AS t " +
          "INNER JOIN analytics.spans AS s ON s.TraceId = t.TraceId " +
          "GROUP BY bucket ORDER BY bucket",
        columns: BUCKET_COLUMNS.map((column) =>
          column.name === "calls" ? { name: "total", type: "UInt64" } : column,
        ),
        rows: [
          hourlyBucket("2026-02-20 10:00:00"),
          hourlyBucket("2026-02-20 11:00:00"),
          hourlyBucket("2026-02-20 14:00:00"),
        ],
        truncated: true,
      });

      expect(codesOf(diagnostics)).toEqual([
        "RESULT_TRUNCATED",
        "POSSIBLE_FANOUT",
        "UNBOUNDED_TIME_RANGE",
        "UNBOUNDED_TIME_RANGE",
        "MISSING_TIME_BUCKETS",
      ]);
    });
  });

  describe("when the vocabulary itself is inspected", () => {
    it("declares every code exactly once", () => {
      expect(new Set(GOVERNED_SQL_DIAGNOSTIC_CODES).size).toBe(
        GOVERNED_SQL_DIAGNOSTIC_CODES.length,
      );
    });
  });
});
