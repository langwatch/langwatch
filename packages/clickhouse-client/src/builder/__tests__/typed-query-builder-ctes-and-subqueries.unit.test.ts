/**
 * ADR-202, "The typed builder": the shapes evaluation's and scenario's reads need: nullable and listed ids, shared id parameters, derived join sides, zoned day starts,
 * CTEs reading earlier CTEs and scalar subqueries, each carrying the tenant predicate.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { idBoundOf } from "../../idBound.ts";
import { defineIdIndex } from "../../idIndexFlags.ts";
import { column, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { systemColumns } from "../system-tables.ts";
import { defineClickHouseTable } from "../table.ts";

const evaluations = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    TraceId: column.nullable(column.string()),
    EvaluatorId: column.string(),
    Status: column.string(),
    Score: column.nullable(column.float64()),
    Attempts: column.uint32(),
    ScheduledAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const runs = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  timeColumn: "StartedAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    Name: column.string(),
    StartedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });
const pair = tenantScope.set({ tenantIds: ["proj_a", "proj_b"] });

/** The client's own marker parser over one declared index, as `read()` runs it at send. */
function lookupOf({
  statement,
  source,
  key,
}: {
  statement: { sql: string; params: Readonly<Record<string, unknown>> };
  source: string;
  key: string;
}) {
  const declaration = defineIdIndex({ source, key: [key], time: "UpdatedAt" });
  const registry = { declarationOf: () => declaration, declarations: () => [declaration] };
  return idBoundOf({ sql: statement.sql, params: { ...statement.params }, registry })?.lookup;
}

/** The refusal a build throws, by code and violation kind, never by message. */
function refusalOf(build: () => unknown): { code: unknown; kind: unknown } {
  try {
    build();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && "violation" in error) {
      const { violation } = error;
      const kind =
        typeof violation === "object" && violation !== null && "kind" in violation
          ? violation.kind
          : undefined;
      return { code: error.code, kind };
    }
    throw error;
  }
  throw new Error("expected a refusal; the build succeeded");
}

/** How many times the text applies the single scope's tenant predicate. */
const predicates = (sql: string) => sql.split("TenantId = {tenantId:String}").length - 1;

describe("given the typed builder and CTE, subquery and id-bound shapes", () => {
  describe("when a read bounds a nullable id column or a list of ids", () => {
    /** @scenario "A read bounds a nullable id or a list of ids by the id index marker" */
    it("renders the equality or the IN list with the marker the client reads", () => {
      const one = clickhouseRead({ scope: single })
        .from(evaluations)
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ idBound }) => idBound(evaluations.TraceId, "trace_1"))
        .build();
      const many = clickhouseRead({ scope: single })
        .from(evaluations)
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ idBound }) => idBound(evaluations.TraceId, ["trace_1", "trace_2"]))
        .build();

      expect(one.sql).toMatchInlineSnapshot(
        `"SELECT EvaluationId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND (TraceId = {v0:String} {{idBound:evaluation_runs.TraceId:v0}})"`,
      );
      expect(many.sql).toMatchInlineSnapshot(
        `"SELECT EvaluationId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND (TraceId IN ({v0:Array(String)}) {{idBound:evaluation_runs.TraceId:v0}})"`,
      );
      expect(many.params).toEqual({ tenantId: "proj_a", v0: ["trace_1", "trace_2"] });
      expect(lookupOf({ statement: many, source: "evaluation_runs", key: "TraceId" })?.key).toEqual(
        { TraceId: ["trace_1", "trace_2"] },
      );
    });

    /** @scenario "A read bounds a nullable id or a list of ids by the id index marker" */
    it("refuses an empty list and a column that does not hold string ids", () => {
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(evaluations)
            .select({ EvaluationId: evaluations.EvaluationId })
            .where(({ idBound }) => idBound(evaluations.TraceId, []))
            .build(),
        ),
      ).toEqual({ code: "store_query_builder", kind: "empty-id-list" });
      clickhouseRead({ scope: single })
        .from(evaluations)
        .select({ EvaluationId: evaluations.EvaluationId })
        // @ts-expect-error a UInt32 column holds no string ids
        .where(({ idBound }) => idBound(evaluations.Attempts, "1"));
    });
  });

  describe("when the same id bounds a CTE and the read that reads it", () => {
    /** @scenario "Equal ids share one parameter so every id bound marker names it" */
    it("names one parameter in both markers, and the client reads one lookup", () => {
      const built = clickhouseRead({ scope: single })
        .from(runs)
        .with("latest", (sub) =>
          sub
            .from(runs)
            .select({ latestAt: fn.max(runs.UpdatedAt) })
            .where(({ idBound }) => idBound(runs.ScenarioRunId, "run_1")),
        )
        .select({ Name: runs.Name })
        .where(({ and, idBound, oneOf }) =>
          and(idBound(runs.ScenarioRunId, "run_1"), oneOf(runs.UpdatedAt, { cte: "latest" })),
        )
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"WITH latest AS (SELECT max(UpdatedAt) AS latestAt FROM simulation_runs WHERE TenantId = {tenantId:String} AND (ScenarioRunId = {v0:String} {{idBound:simulation_runs.ScenarioRunId:v0}})) SELECT Name FROM simulation_runs WHERE TenantId = {tenantId:String} AND ((ScenarioRunId = {v0:String} {{idBound:simulation_runs.ScenarioRunId:v0}}) AND UpdatedAt IN latest)"`,
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: "run_1" });
      expect(
        lookupOf({ statement: built, source: "simulation_runs", key: "ScenarioRunId" })?.key,
      ).toEqual({ ScenarioRunId: "run_1" });
    });
  });

  describe("when a read joins two derived reads", () => {
    const tracesOf = (scope: typeof single) =>
      clickhouseRead({ scope })
        .from(summaries)
        .select({
          TenantId: summaries.TenantId,
          TraceId: summaries.TraceId,
          TraceOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
        })
        .where(({ range }) => range(summaries.OccurredAt, { from: 1_000, until: 2_000 }))
        .groupBy(summaries.TenantId, summaries.TraceId)
        .as("traces");
    const latest = clickhouseRead({ scope: single })
      .from(evaluations)
      .select({
        TenantId: evaluations.TenantId,
        Latest: fn.argMax(fn.tuple(evaluations.TraceId, evaluations.Score), evaluations.UpdatedAt),
      })
      .where(({ oneOf }) => oneOf(evaluations.EvaluatorId, ["ev_1"]))
      .groupBy(evaluations.TenantId, evaluations.EvaluationId)
      .as("latest");
    const scored = clickhouseRead({ scope: single })
      .from(latest)
      .select({
        TenantId: latest.TenantId,
        TraceId: fn.tupleElement(latest.Latest, "0"),
        Score: fn.tupleElement(latest.Latest, "1"),
      })
      .as("scored");

    /** @scenario "A derived join side carries its own tenant predicate and joins on its tenant column" */
    it("renders each side's own read, its predicate inside, joined on the tenant column", () => {
      const traces = tracesOf(single);
      const built = clickhouseRead({ scope: single })
        .from(traces)
        .innerJoin(scored, ({ eq }) => eq(scored.TraceId, traces.TraceId))
        .select({
          Day: fn.toString(
            fn.toStartOfDay(traces.TraceOccurredAt, { timeZone: "Europe/Amsterdam" }),
          ),
          ScoreSum: fn.sum(fn.ifNull(scored.Score, param.float64(0))),
        })
        .groupBy(fn.toStartOfDay(traces.TraceOccurredAt, { timeZone: "Europe/Amsterdam" }))
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT toString(toStartOfDay(traces.TraceOccurredAt, {v0:String})) AS Day, sum(ifNull(scored.Score, {v1:Float64})) AS ScoreSum FROM (SELECT TenantId, TraceId, argMax(OccurredAt, UpdatedAt) AS TraceOccurredAt FROM trace_summaries WHERE TenantId = {tenantId:String} AND (OccurredAt >= fromUnixTimestamp64Milli({v2:Int64}) AND OccurredAt < fromUnixTimestamp64Milli({v3:Int64})) GROUP BY TenantId, TraceId) AS traces INNER JOIN (SELECT TenantId, tupleElement(Latest, 1) AS TraceId, tupleElement(Latest, 2) AS Score FROM (SELECT TenantId, argMax(tuple(TraceId, Score), UpdatedAt) AS Latest FROM evaluation_runs WHERE TenantId = {tenantId:String} AND EvaluatorId IN ({v4:Array(String)}) GROUP BY TenantId, EvaluationId) AS latest) AS scored ON traces.TenantId = scored.TenantId AND scored.TraceId = traces.TraceId GROUP BY toStartOfDay(traces.TraceOccurredAt, {v5:String})"`,
      );
      expect(predicates(built.sql)).toBe(2);
    });

    /** @scenario "A derived join side carries its own tenant predicate and joins on its tenant column" */
    it("refuses a side that drops its tenant column, a side under another scope and a forged side", () => {
      const traces = tracesOf(single);
      const untenanted = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .as("untenanted");
      const renamed = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TenantId: fn.any(summaries.TenantId), TraceId: summaries.TraceId })
        .groupBy(summaries.TraceId)
        .as("renamed");
      const foreign = tracesOf(tenantScope.single({ tenantId: "proj_b" }));
      // The same descriptor's facts copied: a derived table `as` did not make.
      const forged = { ...traces, $table: { ...traces.$table } };
      const read = () => clickhouseRead({ scope: single }).from(scored);

      expect(
        refusalOf(() =>
          read().innerJoin(untenanted, ({ eq }) => eq(untenanted.TraceId, scored.TraceId)),
        ).kind,
      ).toBe("unjoinable");
      expect(
        refusalOf(() => read().innerJoin(renamed, ({ eq }) => eq(renamed.TraceId, scored.TraceId)))
          .kind,
      ).toBe("unjoinable");
      expect(
        refusalOf(() => read().innerJoin(foreign, ({ eq }) => eq(foreign.TraceId, scored.TraceId)))
          .kind,
      ).toBe("foreign-scope");
      expect(
        refusalOf(() => read().leftJoin(forged, ({ eq }) => eq(forged.TraceId, scored.TraceId)))
          .kind,
      ).toBe("foreign-scope");
    });
  });

  describe("when a day start names a time zone", () => {
    /** @scenario "The census functions render with every value bound" */
    it("binds the zone as a String, and leaves the one-argument form as it was", () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({
          day: fn.toStartOfDay(summaries.OccurredAt, { timeZone: "Asia/Tokyo" }),
          hour: fn.toStartOfHour(summaries.OccurredAt),
        })
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT toStartOfDay(OccurredAt, {v0:String}) AS day, toStartOfHour(OccurredAt) AS hour FROM trace_summaries WHERE TenantId = {tenantId:String}"`,
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: "Asia/Tokyo" });
    });
  });

  describe("when a CTE reads an earlier CTE", () => {
    /** @scenario "A CTE reads the CTEs declared before it, and no other name" */
    it("renders the later body reading the earlier name, each body with its own predicate", () => {
      const built = clickhouseRead({ scope: single })
        .from(evaluations)
        .with("traced", (sub) =>
          sub
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ gte }) => gte(summaries.OccurredAt, 1_000)),
        )
        .with("scored", (sub) =>
          sub
            .from(evaluations)
            .select({ EvaluationId: evaluations.EvaluationId })
            .where(({ oneOf }) => oneOf(fn.ifNull(evaluations.TraceId, ""), { cte: "traced" })),
        )
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ oneOf }) => oneOf(evaluations.EvaluationId, { cte: "scored" }))
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"WITH traced AS (SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({v0:Int64})), scored AS (SELECT EvaluationId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND ifNull(TraceId, {v1:String}) IN traced) SELECT EvaluationId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND EvaluationId IN scored"`,
      );
      expect(predicates(built.sql)).toBe(3);
    });

    /** @scenario "A CTE reads the CTEs declared before it, and no other name" */
    it("refuses a name no WITH before it declares: it would read a stored table", () => {
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(evaluations)
            .with("early", (sub) =>
              sub
                .from(evaluations)
                .select({ EvaluationId: evaluations.EvaluationId })
                // @ts-expect-error "late" is declared after this body
                .where(({ oneOf }) => oneOf(evaluations.EvaluationId, { cte: "late" })),
            )
            .with("late", (sub) =>
              sub.from(evaluations).select({ EvaluationId: evaluations.EvaluationId }),
            )
            .select({ EvaluationId: evaluations.EvaluationId })
            .build(),
        ).kind,
      ).toBe("unknown-cte");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(evaluations)
            .select({ EvaluationId: evaluations.EvaluationId })
            // @ts-expect-error trace_summaries is a stored table, not a CTE of this read
            .where(({ oneOf }) => oneOf(evaluations.EvaluationId, { cte: "trace_summaries" }))
            .build(),
        ).kind,
      ).toBe("unknown-cte");
    });
  });

  describe("when a read compares with a scalar subquery", () => {
    /** @scenario "A scalar subquery reads one value under the read's own scope" */
    it("renders the inner read with its own predicate and shares the id parameter", () => {
      const built = clickhouseRead({ scope: pair })
        .from(runs)
        .select({ Name: runs.Name })
        .where(({ and, eq, idBound, scalar }) =>
          and(
            idBound(runs.ScenarioRunId, "run_1"),
            eq(
              runs.UpdatedAt,
              scalar((sub) =>
                sub
                  .from(runs)
                  .select({ v: fn.max(runs.UpdatedAt) })
                  .where(({ idBound: inner }) => inner(runs.ScenarioRunId, "run_1")),
              ),
            ),
          ),
        )
        .limit(1)
        .build();

      expect(built.sql).toMatchInlineSnapshot(
        `"SELECT Name FROM simulation_runs WHERE TenantId IN ({tenantIds:Array(String)}) AND ((ScenarioRunId = {v0:String} {{idBound:simulation_runs.ScenarioRunId:v0}}) AND UpdatedAt = (SELECT max(UpdatedAt) AS v FROM simulation_runs WHERE TenantId IN ({tenantIds:Array(String)}) AND (ScenarioRunId = {v0:String} {{idBound:simulation_runs.ScenarioRunId:v0}}))) LIMIT 1"`,
      );
      expect(built.sql.split("TenantId IN ({tenantIds:Array(String)})")).toHaveLength(3);
      expect(built.params).toEqual({ tenantIds: ["proj_a", "proj_b"], v0: "run_1" });
      expect(
        lookupOf({ statement: built, source: "simulation_runs", key: "ScenarioRunId" })?.key,
      ).toEqual({ ScenarioRunId: "run_1" });
    });

    /** @scenario "A scalar subquery reads one value under the read's own scope" */
    it("refuses a foreign table, an unscoped table and more than one value", () => {
      const foreign = clickhouseRead({ scope: tenantScope.single({ tenantId: "proj_b" }) })
        .from(runs)
        .select({ v: fn.max(runs.UpdatedAt) })
        .as("foreign");

      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(runs)
            .select({ Name: runs.Name })
            .where(({ eq, scalar }) =>
              eq(
                runs.UpdatedAt,
                scalar((sub) => sub.from(foreign).select({ v: foreign.v })),
              ),
            )
            .build(),
        ).kind,
      ).toBe("foreign-scope");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(runs)
            .select({ Name: runs.Name })
            .where(({ eq, scalar }) =>
              eq(
                runs.Name,
                scalar((sub) =>
                  // @ts-expect-error a tenant read reads no system table
                  sub.from(systemColumns).select({ v: systemColumns.name }),
                ),
              ),
            )
            .build(),
        ).kind,
      ).toBe("table-outside-scope");
      expect(
        refusalOf(() =>
          clickhouseRead({ scope: single })
            .from(runs)
            .select({ Name: runs.Name })
            .where(({ eq, scalar }) =>
              eq(
                runs.UpdatedAt,
                scalar((sub) =>
                  sub.from(runs).select({ v: fn.max(runs.UpdatedAt), w: fn.min(runs.UpdatedAt) }),
                ),
              ),
            )
            .build(),
        ).kind,
      ).toBe("scalar-not-one-value");
    });
  });
});
