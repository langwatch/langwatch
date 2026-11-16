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
import {
  joinedTimeseriesRead,
  servesJoinedTraceSummaries,
} from "../clickhouse.joined-timeseries-query.mapper.ts";
import {
  mixedEvalTimeseriesRead,
  servesMixedEval,
} from "../clickhouse.mixed-eval-timeseries-query.mapper.ts";
import {
  pipelineTimeseriesRead,
  servesPipelines,
} from "../clickhouse.pipeline-timeseries-query.mapper.ts";
import { rollupTimeseriesRead } from "../clickhouse.rollup-timeseries-query.mapper.ts";
import { slimTimeseriesRead } from "../clickhouse.slim-timeseries-query.mapper.ts";
import {
  servesSpanGrouped,
  spanGroupedTimeseriesRead,
} from "../clickhouse.span-grouped-timeseries-query.mapper.ts";
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

  describe("when a series is filtered on spans or runs", () => {
    const filtered = (filters: Record<string, unknown>) =>
      ({ ...series("performance.total_cost", "sum"), filters }) as AnalyticsSeries;
    const input: Pick<TimeseriesQueryInput, "series" | "timeScale"> = {
      series: [filtered({ "spans.type": ["tool"] }), filtered({ "evaluations.passed": ["true"] })],
      timeScale: 60,
    };

    it("is a standard read", () => {
      expect(servesStandardTraceSummaries({ ...dates, ...input })).toBe(true);
    });

    it("narrows each series' -If by its own member-and-trace subquery, in both periods' span window", () => {
      const own = inlined(read(traceSummariesTimeseriesRead, input));

      expect(own).toContain(
        `sumIf(TotalCost, ((tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM stored_spans WHERE (TenantId IN (["tenant-a"])) AND (StartTime >= `,
      );
      expect(own).toContain(
        `sumIf(TotalCost, ((tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM evaluation_runs WHERE (TenantId IN (["tenant-a"])) AND (Passed IN ([1])))))), 0)`,
      );
    });

    it("reads each subquery under the aggregate's members", () => {
      const statement = read(traceSummariesTimeseriesRead, input, "aggregate");

      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual([
        "member-b",
        "tenant-a",
      ]);
    });
  });
});

describe("the both-periods trace_summaries summary", () => {
  const input = { series: [series("performance.total_cost", "sum")], timeScale: "full" as const };

  it.each(["own", "aggregate"] as const)(
    "is a reader statement whose tenants are the %s proof's",
    (proof) => {
      const statement = read(traceSummariesTimeseriesRead, input, proof);
      const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
        tenants.toSorted(),
      );
      expect(statement.sql).not.toMatch(/TenantId\s*=/);
    },
  );

  it("reads one ungrouped row per period, each period electing its own latest versions", () => {
    const statement = inlined(read(traceSummariesTimeseriesRead, input));

    expect(statement).toContain("UNION ALL");
    expect(statement).toContain("'current'");
    expect(statement).toContain("'previous'");
    expect(statement.match(/\(TenantId, TraceId, UpdatedAt\) IN \(/g)).toHaveLength(2);
    expect(statement).not.toMatch(/GROUP BY period/);
    expect(statement).toContain("log_comment = 'analytics:timeseries:trace_summaries'");
  });

  it("coalesces an additive series to zero over an empty period", () => {
    const statement = inlined(read(traceSummariesTimeseriesRead, input));

    expect(statement).toMatch(/coalesce\(.*sum\(TotalCost\).*, 0\)/);
  });
});

describe("the mixed trace and evaluation read", () => {
  const mix = [
    series("performance.total_cost", "sum"),
    { ...series("evaluations.evaluation_score", "avg"), key: "ev" } as AnalyticsSeries,
  ];

  it.each([
    ["own", 60],
    ["aggregate", 60],
    ["own", "full"],
    ["aggregate", "full"],
  ] as const)(
    "is a reader statement whose tenants are the %s proof's at scale %s",
    (proof, timeScale) => {
      const statement = read(mixedEvalTimeseriesRead, { series: mix, timeScale }, proof);
      const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
        tenants.toSorted(),
      );
      expect(statement.sql).toContain(
        "log_comment = 'analytics:timeseries:trace_summaries:mixed_eval'",
      );
    },
  );

  it("aggregates the runs per member's trace before re-aggregating across traces", () => {
    const statement = inlined(read(mixedEvalTimeseriesRead, { series: mix, timeScale: 60 }));

    expect(statement).toMatch(/INNER JOIN/);
    expect(statement).toMatch(/GROUP BY trace_summaries\.TenantId, trace_summaries\.TraceId/);
    expect(statement).toMatch(/avg\(m1\)/);
    expect(statement).toMatch(/coalesce\(sum\(v0\), 0\)/);
  });

  it("serves trace metrics beside run metrics, and nothing else", () => {
    const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
      servesMixedEval({ ...dates, series: mix, timeScale: 60, ...input });

    expect(serves({})).toBe(true);
    expect(serves({ timeScale: "full", groupBy: "metadata.user_id" })).toBe(true);
    expect(serves({ series: [mix[0]!] })).toBe(false);
    expect(serves({ series: [mix[1]!] })).toBe(false);
    expect(serves({ groupBy: "metadata.model" })).toBe(false);
    expect(serves({ series: [...mix, series("metadata.span_type", "count")] })).toBe(false);
    expect(serves({ series: [...mix, series("events.event_score", "avg")] })).toBe(false);
    expect(
      serves({
        series: [
          ...mix,
          {
            ...series("performance.total_cost", "sum"),
            pipeline: { field: "user_id", aggregation: "avg" },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
  });
});

describe("the trace_summaries read joined to spans or runs", () => {
  const spans = [series("sentiment.thumbs_up_down", "avg")];
  const runs = [{ ...series("evaluations.evaluation_score", "avg"), key: "ev" } as AnalyticsSeries];

  it.each([
    ["own", 60],
    ["aggregate", 60],
    ["own", "full"],
    ["aggregate", "full"],
  ] as const)(
    "is a reader statement whose tenants are the %s proof's at scale %s",
    (proof, timeScale) => {
      const statement = read(
        joinedTimeseriesRead,
        { series: spans, groupBy: "evaluations.evaluation_passed", timeScale },
        proof,
      );
      const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
        tenants.toSorted(),
      );
      expect(statement.sql).toContain(
        "log_comment = 'analytics:timeseries:trace_summaries:joined'",
      );
    },
  );

  it("joins each side on the member and the trace, spans within main's StartTime envelope", () => {
    const statement = inlined(
      read(joinedTimeseriesRead, {
        series: spans,
        groupBy: "evaluations.evaluation_passed",
        timeScale: 60,
      }),
    );

    expect(statement.match(/INNER JOIN/g)).toHaveLength(2);
    expect(statement).toMatch(/spans\.TenantId = trace_summaries\.TenantId/);
    expect(statement).toMatch(/runs\.TenantId = trace_summaries\.TenantId/);
    expect(statement).toContain(String(dates.previousPeriodStartDate.getTime() - 2 * 86_400_000));
    expect(statement).toContain(String(dates.endDate.getTime() + 2 * 86_400_000));
  });

  it("keeps only the named evaluator's verdicts when grouped by one", () => {
    const statement = inlined(
      read(joinedTimeseriesRead, {
        series: runs,
        groupBy: "evaluations.evaluation_passed",
        groupByKey: "ev",
        timeScale: 60,
      }),
    );

    expect(statement).toMatch(/HAVING multiIf\(.+\) IS NOT NULL/s);
  });

  it("serves span or run metrics and run groupings, and leaves the rest to their shapes", () => {
    const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
      servesJoinedTraceSummaries({ ...dates, series: spans, timeScale: 60, ...input });
    const cost = series("performance.total_cost", "sum");

    expect(serves({})).toBe(true);
    expect(serves({ series: runs, groupBy: "topics.topics" })).toBe(true);
    expect(serves({ series: [cost], groupBy: "evaluations.evaluation_label" })).toBe(true);
    expect(serves({ timeScale: "full", groupBy: "metadata.user_id" })).toBe(true);
    expect(serves({ series: [cost] })).toBe(false);
    expect(serves({ timeScale: "full" })).toBe(false);
    expect(serves({ series: [...runs, cost] })).toBe(false);
    expect(serves({ series: [...runs, ...spans] })).toBe(false);
    expect(serves({ groupBy: "metadata.labels" })).toBe(false);
    expect(serves({ groupBy: "metadata.span_type" })).toBe(false);
    expect(serves({ groupBy: "metadata.model" })).toBe(false);
    expect(
      serves({
        series: [
          {
            ...spans[0]!,
            pipeline: { field: "user_id", aggregation: "avg" },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
  });
});

describe("the trace_summaries read grouped by a key a trace holds several of", () => {
  const trace = [series("performance.total_cost", "sum")];

  it.each([
    ["own", "metadata.labels", 60],
    ["aggregate", "metadata.labels", "full"],
    ["own", "metadata.span_type", "full"],
    ["aggregate", "sentiment.thumbs_up_down", 60],
    ["own", "metadata.model", 60],
    ["aggregate", "metadata.model", "full"],
  ] as const)(
    "is a reader statement whose tenants are the %s proof's, grouped by %s at scale %s",
    (proof, groupBy, timeScale) => {
      const statement = read(
        spanGroupedTimeseriesRead,
        { series: trace, groupBy, timeScale },
        proof,
      );
      const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
        tenants.toSorted(),
      );
      expect(statement.sql).toContain(
        "log_comment = 'analytics:timeseries:trace_summaries:span_grouped'",
      );
    },
  );

  it("keeps one row per member's trace and key, joining spans on the member and the trace", () => {
    const statement = inlined(
      read(spanGroupedTimeseriesRead, {
        series: trace,
        groupBy: "events.event_type",
        timeScale: 60,
      }),
    );

    expect(statement.match(/INNER JOIN/g)).toHaveLength(1);
    expect(statement).toMatch(/spans\.TenantId = trace_summaries\.TenantId/);
    expect(statement).toMatch(/GROUP BY trace_summaries\.TenantId, trace_summaries\.TraceId/);
    expect(statement).toContain("arrayJoin(spans.eventNames)");
    expect(statement).toMatch(/HAVING .+ != ''/s);
  });

  it("splits each member's trace across its span models, with main's join settings", () => {
    const sql = inlined(
      read(spanGroupedTimeseriesRead, { series: trace, groupBy: "metadata.model", timeScale: 60 }),
    );

    expect(sql.match(/LEFT JOIN/g)).toHaveLength(1);
    expect(sql).not.toContain("INNER JOIN");
    expect(sql).toMatch(/smd\.TenantId = trace_summaries\.TenantId/);
    expect(sql).toMatch(/GROUP BY TenantId, TraceId, SpanId, multiIf\(/);
    expect(sql).toMatch(/GROUP BY trace_summaries\.TenantId, trace_summaries\.TraceId/);
    expect(sql).toContain("arrayJoin(");
    expect(sql).not.toMatch(/HAVING/);
    expect(sql).toContain(
      "join_algorithm = 'grace_hash', max_bytes_in_join = 200000000, max_threads = 4",
    );
  });

  it("keeps only the filtered labels when it filters and groups by labels", () => {
    const statement = inlined(
      read(spanGroupedTimeseriesRead, {
        series: trace,
        groupBy: "metadata.labels",
        filters: { "metadata.labels": ["a-label-0"] },
        timeScale: 60,
      }),
    );

    expect(statement).not.toContain("INNER JOIN");
    expect(statement).toContain('WHERE group_key IN (["a-label-0"])');
  });

  it("serves trace-row metrics under the five groupings, and leaves the rest to their shapes", () => {
    const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
      servesSpanGrouped({
        ...dates,
        series: trace,
        timeScale: 60,
        groupBy: "metadata.labels",
        ...input,
      });

    expect(serves({})).toBe(true);
    expect(serves({ groupBy: "metadata.span_type", timeScale: "full" })).toBe(true);
    expect(serves({ groupBy: "events.event_type" })).toBe(true);
    expect(serves({ groupBy: "sentiment.thumbs_up_down" })).toBe(true);
    expect(serves({ groupBy: "metadata.model", timeScale: "full" })).toBe(true);
    expect(serves({ groupBy: "topics.topics" })).toBe(false);
    expect(serves({ groupBy: undefined })).toBe(false);
    expect(serves({ series: [series("sentiment.thumbs_up_down", "avg")] })).toBe(false);
    expect(
      serves({
        series: [
          { ...series("evaluations.evaluation_score", "avg"), key: "ev" } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
    expect(
      serves({
        series: [
          { ...trace[0]!, pipeline: { field: "user_id", aggregation: "avg" } } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
  });
});

describe("the trace_summaries pipeline read", () => {
  const perUser = {
    ...series("performance.total_cost", "sum"),
    pipeline: { field: "user_id", aggregation: "avg" },
  } as AnalyticsSeries;
  const perTrace = {
    ...series("performance.total_cost", "sum"),
    pipeline: { field: "trace_id", aggregation: "avg" },
  } as AnalyticsSeries;
  const threadsPerUser = {
    ...series("threads.average_duration_per_thread", "avg"),
    pipeline: { field: "user_id", aggregation: "max" },
  } as AnalyticsSeries;

  it.each([
    ["own", 60],
    ["aggregate", 60],
    ["own", "full"],
    ["aggregate", "full"],
  ] as const)(
    "is a reader statement whose tenants are the %s proof's at scale %s",
    (proof, timeScale) => {
      const statement = read(
        pipelineTimeseriesRead,
        { series: [series("performance.total_cost", "sum"), perUser, threadsPerUser], timeScale },
        proof,
      );
      const tenants = proof === "own" ? ["tenant-a"] : ["tenant-a", "member-b"];

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantIds?.toSorted()).toEqual(tenants.toSorted());
      expect(statement.settings.SQL_langwatch_tenant_ids.split(",").toSorted()).toEqual(
        tenants.toSorted(),
      );
      expect(statement.sql).not.toMatch(/TenantId\s*=/);
      expect(statement.sql).toContain(
        "log_comment = 'analytics:timeseries:trace_summaries:pipelines'",
      );
    },
  );

  it("groups each per-entity step by the member, a trace id included", () => {
    const sql = inlined(read(pipelineTimeseriesRead, { series: [perTrace], timeScale: 60 }));

    expect(sql).toContain("TenantId, TraceId HAVING (TraceId != '')");
    expect(sql).toMatch(/avg\(inner_value\)/);
  });

  it("stacks one arm per re-aggregated series and keeps the first source's buckets", () => {
    const sql = inlined(
      read(pipelineTimeseriesRead, {
        series: [series("performance.total_cost", "sum"), perUser, threadsPerUser],
        timeScale: 60,
      }),
    );

    expect(sql.match(/UNION ALL/g)).toHaveLength(2);
    expect(sql).toMatch(/HAVING max\(anchored\) > 0/);
    expect(sql).not.toMatch(/JOIN/);
  });

  it("serves pipelines and thread durations on trace rows, and leaves the rest to their shapes", () => {
    const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
      servesPipelines({ ...dates, series: [perUser], timeScale: 60, ...input });

    expect(serves({})).toBe(true);
    expect(serves({ timeScale: "full" })).toBe(true);
    expect(serves({ series: [series("threads.average_duration_per_thread", "avg")] })).toBe(true);
    expect(serves({ groupBy: "metadata.user_id" })).toBe(true);
    expect(serves({ groupBy: "metadata.user_id", timeScale: "full" })).toBe(false);
    expect(serves({ groupBy: "metadata.labels" })).toBe(false);
    expect(serves({ series: [series("performance.total_cost", "sum")] })).toBe(false);
    expect(
      serves({
        series: [
          {
            ...series("evaluations.evaluation_score", "avg"),
            key: "ev",
            pipeline: { field: "user_id", aggregation: "avg" },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(false);
  });

  it("refuses a filtered per-entity series shown as a percentage", () => {
    expect(() =>
      read(pipelineTimeseriesRead, {
        series: [
          {
            ...perUser,
            filters: { "traces.error": ["false"] },
            asPercent: true,
          } as AnalyticsSeries,
        ],
        timeScale: 60,
      }),
    ).toThrow(expect.objectContaining({ code: "analytics_series_percentage_unsupported" }));
  });
});

describe("which queries the standard trace_summaries read serves", () => {
  const base: Pick<TimeseriesQueryInput, "series" | "timeScale"> = {
    series: [series("performance.total_cost", "sum")],
    timeScale: 60,
  };
  const serves = (input: Partial<Omit<TimeseriesQueryInput, keyof typeof dates>>) =>
    servesStandardTraceSummaries({ ...dates, ...base, ...input });

  it("serves trace-row metrics bucketed by date, filtered (a series too), negated or trace-scoped", () => {
    expect(serves({})).toBe(true);
    expect(
      serves({ filters: { "evaluations.passed": { ev: ["true"] } }, negateFilters: true }),
    ).toBe(true);
    expect(serves({ traceIds: ["t"] })).toBe(true);
    expect(
      serves({
        series: [
          {
            ...series("performance.total_cost", "sum"),
            filters: { "spans.type": ["llm"] },
          } as AnalyticsSeries,
        ],
      }),
    ).toBe(true);
  });

  it("serves the both-periods summary of trace-row metrics", () => {
    expect(serves({ timeScale: "full" })).toBe(true);
    expect(serves({ timeScale: "full", groupBy: "metadata.user_id" })).toBe(true);
  });

  it("leaves joins, pipelines and array groupings to their shapes", () => {
    expect(serves({ timeScale: "full", groupBy: "metadata.labels" })).toBe(false);
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
  });
});
