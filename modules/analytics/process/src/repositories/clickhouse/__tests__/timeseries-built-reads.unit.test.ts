/**
 * The slim and rollup timeseries reads on the typed builder (ADR-034 Phase 3, ADR-202): each table,
 * its fence and partition range, the spillable dedup, the has-signal gate and the aggregates, as
 * the built statements carry them. Rows against main's are proven on 26.8 (path C proof).
 */
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { type ReaderReadStatement, tenantScope } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { TimeseriesQueryInput } from "../clickhouse.aggregation-builder.mapper.ts";
import { evalRollupTimeseriesRead } from "../clickhouse.eval-rollup-timeseries-query.mapper.ts";
import { evalSlimTimeseriesRead } from "../clickhouse.eval-slim-timeseries-query.mapper.ts";
import { rollupTimeseriesRead } from "../clickhouse.rollup-timeseries-query.mapper.ts";
import { slimTimeseriesRead } from "../clickhouse.slim-timeseries-query.mapper.ts";
import type { TimeseriesRead } from "../clickhouse.timeseries-query-shared.mapper.ts";
import {
  servesStandardTraceSummaries,
  traceSummariesTimeseriesRead,
} from "../clickhouse.trace-summaries-timeseries-query.mapper.ts";

const dates = {
  projectId: "tenant-a",
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
};

const PROOFS = {
  own: () => analyticsProof({ projectId: "tenant-a" }),
  aggregate: () =>
    analyticsProof({
      projectId: "tenant-a",
      shared: [{ projectId: "member-b", from: Date.UTC(2026, 5, 1) }],
    }),
};

type Reader = (read: TimeseriesRead) => ReaderReadStatement;

const read = (
  build: Reader,
  input: Omit<TimeseriesQueryInput, keyof typeof dates>,
  proof: keyof typeof PROOFS = "own",
) =>
  build({
    scope: tenantScope.fromProof({ authorization: PROOFS[proof](), reads: "analytics" }),
    input: { ...dates, ...input },
    settings: { max_bytes_before_external_group_by: 500_000_000 },
  });

/** The statement's SQL with each bound value written in, for readable assertions. */
const inlined = (statement: ReaderReadStatement): string =>
  statement.sql.replaceAll(/\{(\w+):[^}]+\}/g, (_, name: string) => {
    const value = statement.params[name];
    return typeof value === "string" ? `'${value}'` : JSON.stringify(value);
  });

const series = (metric: string, aggregation: string) =>
  ({ metric, aggregation }) as AnalyticsSeries;

describe("each timeseries read on the typed builder", () => {
  const READS: [string, Reader, Omit<TimeseriesQueryInput, keyof typeof dates>][] = [
    [
      "trace_analytics_rollup",
      rollupTimeseriesRead,
      { series: [series("performance.total_cost", "sum")], timeScale: 60 },
    ],
    [
      "trace_analytics",
      slimTimeseriesRead,
      { series: [series("performance.total_cost", "sum")], timeScale: 60 },
    ],
    [
      "evaluation_analytics_rollup",
      evalRollupTimeseriesRead,
      { series: [series("evaluations.evaluation_runs", "sum")], timeScale: 60 },
    ],
    [
      "evaluation_analytics",
      evalSlimTimeseriesRead,
      { series: [series("evaluations.evaluation_score", "avg")], timeScale: 60 },
    ],
    [
      "trace_summaries",
      traceSummariesTimeseriesRead,
      { series: [series("performance.total_cost", "sum")], timeScale: 60 },
    ],
  ];

  describe.each(READS)("when %s is read", (table, build, input) => {
    it.each(["own", "aggregate"] as const)(
      "is a reader statement whose tenants are the %s proof's",
      (proof) => {
        const statement = read(build, input, proof);
        const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

        expect(statement.identity).toBe("reader");
        expect(statement.kind).toBe("tenant");
        expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
        expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
          tenants.toSorted(),
        );
        expect(statement.sql).toContain(`FROM ${table}`);
        expect(statement.sql).not.toMatch(/TenantId\s*=/);
      },
    );

    it("names its table in the log comment and keeps the caller's settings", () => {
      const statement = read(build, input);

      expect(statement.sql).toContain(`log_comment = 'analytics:timeseries:${table}'`);
      expect(statement.sql).toContain("max_bytes_before_external_group_by = 500000000");
    });
  });
});

describe("the trace rollup read", () => {
  const statement = inlined(
    read(rollupTimeseriesRead, {
      series: [series("performance.total_cost", "sum")],
      timeScale: 60,
    }),
  );

  it("filters both periods on the partition column BucketStart", () => {
    expect(statement).toContain(
      `(BucketStart >= fromUnixTimestamp64Milli(${dates.startDate.getTime()}) AND BucketStart < fromUnixTimestamp64Milli(${dates.endDate.getTime()}))`,
    );
    expect(statement).toContain(
      `BucketStart >= fromUnixTimestamp64Milli(${dates.previousPeriodStartDate.getTime()})`,
    );
  });

  it("sums CostSum without any *Merge combinator", () => {
    expect(statement).toContain("coalesce(sum(CostSum), 0)");
    expect(statement).not.toMatch(/sumMerge|avgMerge|countMerge|quantileMerge/);
  });

  it("groups by period and date only, the rollup being an ungrouped fast path", () => {
    expect(statement).not.toContain("group_key");
    expect(statement).toContain("ORDER BY period ASC, date ASC");
  });

  it("buckets hourly with toStartOfInterval on BucketStart in the dashboard's zone", () => {
    const zoned = inlined(
      read(rollupTimeseriesRead, {
        series: [series("performance.total_cost", "sum")],
        timeScale: 60,
        timeZone: "Europe/Amsterdam",
      }),
    );

    expect(zoned).toContain(
      "toStartOfInterval(BucketStart, toIntervalHour(1), 'Europe/Amsterdam')",
    );
  });

  describe("when the series is an ungrouped avg on completion_time", () => {
    it("divides the duration sum by the TraceCount denominator", () => {
      const avg = inlined(
        read(rollupTimeseriesRead, {
          series: [series("performance.completion_time", "avg")],
          timeScale: 60,
        }),
      );

      expect(avg).toContain("divide(sum(DurationSum), nullIf(sum(TraceCount), 0))");
    });
  });

  describe("when a shape the router excludes reaches the read", () => {
    it("throws on avg of a nullable metric instead of returning wrong numbers", () => {
      expect(() =>
        read(rollupTimeseriesRead, { series: [series("performance.total_cost", "avg")] }),
      ).toThrow(/avg\(performance\.total_cost\)/);
    });

    it("throws on any group-by: per-span attribution and root-only columns diverge from legacy", () => {
      for (const groupBy of ["metadata.model", "metadata.span_type", "topics.topics"]) {
        expect(() =>
          read(rollupTimeseriesRead, {
            series: [series("performance.completion_time", "avg")],
            groupBy,
          }),
        ).toThrow(/cannot group by/);
      }
    });

    it("throws on min/max: min/max of per-part sums is merge-state-dependent", () => {
      for (const aggregation of ["min", "max"]) {
        expect(() =>
          read(rollupTimeseriesRead, { series: [series("performance.total_cost", aggregation)] }),
        ).toThrow(/cannot serve aggregation/);
      }
    });
  });
});

describe("the trace slim read", () => {
  const statement = inlined(
    read(slimTimeseriesRead, {
      series: [
        series("performance.completion_time", "p95"),
        series("performance.total_cost", "sum"),
      ],
      groupBy: "topics.topics",
      timeScale: 1440,
      filters: { "metadata.user_id": ["alice"] },
    }),
  );
  const latestRow = statement.match(/tuple\(([\s\S]+?)\) AS __latest_row/)?.[1] ?? "";

  /** @scenario Dashboard panels dedup traces with a collapse that can spill to disk */
  it("dedups trace_analytics to the latest version with the spillable argMax collapse", () => {
    expect(statement).toContain("argMax(__latest_row, __version) AS __latest");
    expect(statement).toContain("UpdatedAt AS __version");
    expect(statement).toContain("GROUP BY TenantId, TraceId");
    expect(statement).not.toContain("(TenantId, TraceId, UpdatedAt) IN (");
  });

  it("carries only the columns the query reads, never the whole Attributes map", () => {
    expect(latestRow).toMatch(/^OccurredAt, TotalCost, TotalDurationMs, TopicId,/);
    expect(latestRow).not.toMatch(/(?<!\[)\bAttributes\b(?!\[)/);
    expect(statement).not.toMatch(/SELECT\s+\*/);
  });

  it("filters both periods on OccurredAt inside the dedup, and the latest version outside", () => {
    expect(statement).toContain(
      `(OccurredAt >= fromUnixTimestamp64Milli(${dates.startDate.getTime()}) AND OccurredAt < fromUnixTimestamp64Milli(${dates.endDate.getTime()}))`,
    );
    expect(statement).toContain(
      `tupleElement(__latest, 1) >= fromUnixTimestamp64Milli(${dates.previousPeriodStartDate.getTime()})`,
    );
  });

  /**
   * The fold writes a row for every state it is handed, including one whose only signal is a
   * topic or an annotation; this predicate keeps such rows out of every aggregate.
   */
  /** @scenario absence is authoritative because nothing is ever gated out */
  /** @scenario Analytics' trace_analytics reader applies the has-signal predicate analytics owns */
  it("keeps dimension-only rows out with every door the fold's signal test opens", () => {
    expect(latestRow).toContain(
      "(SpanCount > 0 OR EarliestSpanStartMs > 0 OR NOT (Attributes['langwatch.reserved.log_record_count'] IN ([\"\",\"0\"])) OR Version < '2026-07-27')",
    );
    expect(statement).toContain("AND tupleElement(__latest, 5) AND tupleElement(__latest, 6))");
  });

  /** @scenario Dashboard percentiles use a bounded-memory estimator */
  it("uses quantileTDigest for percentile aggregations", () => {
    expect(statement).toContain("quantileTDigest(0.95)(tupleElement(__latest, 3))");
    expect(statement).not.toContain("quantileExact");
  });

  it("sums the newest TotalCost and keeps HAVING for group-bys legacy filters, e.g. topics", () => {
    expect(statement).toContain("coalesce(sum(tupleElement(__latest, 2)), 0)");
    expect(statement).toContain("!= ''");
  });

  it("reads the typed UserId column, bound as a parameter, for the user filter", () => {
    expect(latestRow).toContain('UserId IN (["alice"])');
  });

  describe("when the query leaves out trace origins", () => {
    /** @scenario Leaving out an origin keeps the rest of the count intact */
    it("adds a NOT IN on the origin column after the filters", () => {
      const excluded = inlined(
        read(slimTimeseriesRead, {
          series: [series("performance.total_cost", "sum")],
          timeScale: "full",
          filters: { "metadata.user_id": ["alice"] },
          excludeOrigins: ["langy"],
        }),
      );

      expect(excluded).toContain('(UserId IN (["alice"]) AND NOT (Origin IN (["langy"])))');
    });

    it("adds nothing when the exclusion is empty", () => {
      const kept = inlined(
        read(slimTimeseriesRead, {
          series: [series("performance.total_cost", "sum")],
          timeScale: "full",
          excludeOrigins: [],
        }),
      );

      expect(kept).not.toContain("Origin");
    });
  });

  it("throws on a model group-by, which the router sends to trace_summaries", () => {
    expect(() =>
      read(slimTimeseriesRead, {
        series: [series("performance.total_cost", "sum")],
        groupBy: "metadata.model",
      }),
    ).toThrow(/cannot group by "metadata\.model"/);
  });

  it("counts each thread and user by its member", () => {
    const counted = inlined(
      read(slimTimeseriesRead, {
        series: [
          series("metadata.thread_id", "cardinality"),
          series("metadata.user_id", "cardinality"),
        ],
      }),
    );

    expect(counted).toContain(
      "uniq(if(tupleElement(__latest, 2) = '', '', concat(TenantId, '/', tupleElement(__latest, 2))))",
    );
    expect(counted).toContain(
      "uniq(if(tupleElement(__latest, 3) = '', '', concat(TenantId, '/', tupleElement(__latest, 3))))",
    );
  });
});

describe("the analytics total tokens metric on the rollup and slim tables", () => {
  const tokens = { series: [series("performance.total_tokens", "sum")], timeScale: 60 };

  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on the per-minute rollup", () => {
    const statement = read(rollupTimeseriesRead, tokens).sql;

    expect(statement).toContain("CacheReadTokensSum");
    expect(statement).toContain("CacheWriteTokensSum");
  });

  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on the slim table", () => {
    const statement = read(slimTimeseriesRead, tokens).sql;

    expect(statement).toContain("CacheReadTokens");
    expect(statement).toContain("CacheWriteTokens");
  });
});

describe("the evaluation slim read", () => {
  /** @scenario Dashboard percentiles use a bounded-memory estimator */
  it("uses the bounded-memory t-digest estimator for a percentile of evaluation_score", () => {
    const statement = read(evalSlimTimeseriesRead, {
      series: [series("evaluations.evaluation_score", "p90")],
      timeScale: 60,
    }).sql;

    expect(statement).toContain("quantileTDigest(0.9)(");
    expect(statement).not.toContain("quantileExact");
  });

  it("refuses a filter, which the router sends to evaluation_runs", () => {
    expect(() =>
      read(evalSlimTimeseriesRead, {
        series: [series("evaluations.evaluation_score", "avg")],
        filters: { "metadata.key": ["a", "b"] },
      }),
    ).toThrow(/Eval slim builder cannot serve filter "metadata.key"/);
  });
});

describe("the standard trace_summaries read", () => {
  const statement = inlined(
    read(traceSummariesTimeseriesRead, {
      series: [series("performance.total_cost", "sum")],
      filters: { "spans.type": ["llm"] },
      negateFilters: true,
      excludeOrigins: ["evaluation"],
      timeScale: 60,
    }),
  );

  it("elects each trace's latest version by an IN-tuple over the proof's windows", () => {
    expect(statement).toMatch(/\(TenantId, TraceId, UpdatedAt\) IN \(/);
  });

  it("negates a side-table filter as NOT IN, and leaves the origin exclusion un-negated", () => {
    expect(statement).toMatch(/NOT IN \(/);
    expect(statement).toContain(`NOT (Attributes['langwatch.origin'] IN (["evaluation"]))`);
  });

  it("sums cost as main did, zero over no rows", () => {
    expect(statement).toContain("coalesce(sum(TotalCost), 0)");
  });
});

describe("which queries the standard trace_summaries read serves", () => {
  const base: Pick<TimeseriesQueryInput, "series" | "timeScale"> = {
    series: [series("performance.total_cost", "sum")],
    timeScale: 60,
  };
  const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
    servesStandardTraceSummaries({ ...dates, ...base, ...input });

  it("serves trace-row metrics bucketed by date, filtered, negated or trace-scoped", () => {
    expect(serves({})).toBe(true);
    expect(
      serves({ filters: { "evaluations.passed": { ev: ["true"] } }, negateFilters: true }),
    ).toBe(true);
    expect(serves({ traceIds: ["t"] })).toBe(true);
  });

  it("leaves the both-periods summary, joins, pipelines and array groupings to their shapes", () => {
    expect(serves({ timeScale: "full" })).toBe(false);
    expect(serves({ groupBy: "metadata.labels" })).toBe(false);
    expect(serves({ groupBy: "metadata.model" })).toBe(false);
    expect(serves({ series: [series("evaluations.evaluation_score", "avg")] })).toBe(false);
    expect(serves({ series: [series("events.event_type", "cardinality")] })).toBe(false);
    expect(
      serves({
        series: [
          {
            ...series("performance.total_cost", "sum"),
            pipeline: { field: "user_id", aggregation: "avg" },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
    expect(
      serves({
        series: [
          {
            ...series("performance.total_cost", "sum"),
            filters: { "spans.type": ["llm"] },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
  });
});
