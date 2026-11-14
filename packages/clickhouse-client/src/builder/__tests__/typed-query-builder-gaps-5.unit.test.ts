/**
 * ADR-202, "The typed builder": a read declares the columns its election repeats, keeps a page
 * cursor out of the election, and tests tuple membership against zipped bound arrays.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { column, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError, type QueryBuilderViolation } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const runs = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  timeColumn: "StartedAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    ScenarioSetId: column.string(),
    ScenarioId: column.string(),
    ArchivedAt: column.nullable(column.dateTime64({ precision: 3 })),
    StartedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    Links: column.stringArray(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });

/** The read split at its election: the outer text, then the election's subquery. */
function partsOf(sql: string): { outer: string; election: string } {
  const at = sql.indexOf("IN (SELECT ");
  return { outer: sql.slice(0, at), election: sql.slice(at) };
}

function refusalOf(build: () => unknown): QueryBuilderViolation {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error.violation;
    throw error;
  }
  throw new Error("expected a QueryBuilderError");
}

/** The scenario atom scope's shape: set filters, exclusions and filters on unstable columns. */
const atomScope = ({ repeat }: { repeat: readonly (typeof runs.ScenarioSetId)[] }) =>
  clickhouseRead({ scope: single })
    .from(runs)
    .select({ ScenarioRunId: runs.ScenarioRunId })
    .where(({ and, ne, not, oneOf }) =>
      and(
        ne(runs.ScenarioId, ""),
        not(fn.endsWith(runs.ScenarioSetId, "-agent-test")),
        ne(runs.ScenarioSetId, "voice-calls"),
        oneOf(runs.ScenarioSetId, ["set_1", "set_2"]),
      ),
    )
    .where(({ isNull }) => isNull(runs.ArchivedAt))
    .latestVersion({ repeat })
    .build();

describe("given a latest-version read filtering a column stable per key", () => {
  describe("when the read declares that column in the election's repeat list", () => {
    /** @scenario "A latest-version read repeats the conditions on the columns it declares stable per key" */
    it("repeats each term reading only that column inside the election, sharing its parameters", () => {
      const statement = atomScope({ repeat: [runs.ScenarioSetId] });
      const { outer, election } = partsOf(statement.sql);

      expect(election).toContain(
        "AND NOT (endsWith(ScenarioSetId, {v0:String})) AND ScenarioSetId != {v1:String} AND ScenarioSetId IN ({v2:Array(String)}) GROUP BY",
      );
      expect(outer).toContain(
        "ScenarioId != {v3:String} AND NOT (endsWith(ScenarioSetId, {v0:String}))",
      );
      expect(Object.values(statement.params)).toHaveLength(5);
    });

    /** @scenario "A latest-version read repeats the conditions on the columns it declares stable per key" */
    it("keeps terms on undeclared columns out of the election", () => {
      const { election } = partsOf(atomScope({ repeat: [runs.ScenarioSetId] }).sql);

      expect(election).not.toContain("ScenarioId !=");
      expect(election).not.toContain("ArchivedAt");
    });
  });

  describe("when the read declares no repeat list", () => {
    /** @scenario "A latest-version read repeats the conditions on the columns it declares stable per key" */
    it("leaves the election as before, without the stable column's filters", () => {
      const { election } = partsOf(atomScope({ repeat: [] }).sql);

      expect(election).toBe(
        "IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt) FROM simulation_runs WHERE TenantId = {tenantId:String} GROUP BY TenantId, ScenarioRunId)",
      );
    });
  });

  describe("when the repeat list names the tenant column or another table's column", () => {
    /** @scenario "A latest-version read repeats the conditions on the columns it declares stable per key" */
    it("refuses the read", () => {
      const tenant = refusalOf(() =>
        clickhouseRead({ scope: single })
          .from(runs)
          .select({ ScenarioRunId: runs.ScenarioRunId })
          .latestVersion({ repeat: [runs.TenantId] }),
      );
      const foreign = refusalOf(() =>
        clickhouseRead({ scope: single })
          .from(runs)
          .select({ ScenarioRunId: runs.ScenarioRunId })
          // @ts-expect-error a column of a table the read does not read
          .latestVersion({ repeat: [spans.TraceId] }),
      );

      expect(tenant).toEqual({
        kind: "repeat-outside-election",
        table: "simulation_runs",
        column: "simulation_runs.TenantId",
      });
      expect(foreign.kind).toBe("repeat-outside-election");
    });
  });
});

/** trace-span's page: one trace's latest spans after a `(StartTime, SpanId)` cursor. */
const spanPage = ({ inElection }: { inElection?: boolean }) =>
  clickhouseRead({ scope: single })
    .from(spans)
    .latestVersion()
    .select({ SpanId: spans.SpanId })
    .where(({ eq }) => eq(spans.TraceId, "trace_1"))
    .where(
      ({ gt }) =>
        gt(
          fn.tuple(spans.StartTime, spans.SpanId),
          fn.tuple(param.epochMs(1_000), param.string("span_1")),
        ),
      inElection === undefined ? {} : { inElection },
    )
    .build();

describe("given a latest-version read paged by a cursor on its key and time columns", () => {
  describe("when the cursor condition is marked inElection false", () => {
    /** @scenario "A where condition marked outside the election filters the elected rows only" */
    it("filters the outer rows by the cursor and elects over every version of the key", () => {
      const { outer, election } = partsOf(spanPage({ inElection: false }).sql);

      expect(outer).toContain(
        "AND tuple(StartTime, SpanId) > tuple(fromUnixTimestamp64Milli({v1:Int64}), {v2:String})",
      );
      expect(election).toContain("WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}");
      expect(election).not.toContain("StartTime");
    });
  });

  describe("when the cursor condition carries no option", () => {
    /** @scenario "A where condition marked outside the election filters the elected rows only" */
    it("repeats the cursor inside the election, as before", () => {
      const { election } = partsOf(spanPage({}).sql);

      expect(election).toContain("tuple(StartTime, SpanId) > tuple(");
    });
  });
});

describe("given a lookup of span keys sent as two parallel arrays", () => {
  describe("when the key tuple is tested against the zipped bound arrays", () => {
    /** @scenario "A key tuple is a member of zipped bound arrays" */
    it("renders the tuple's membership in arrayZip of two bound String arrays", () => {
      const statement = clickhouseRead({ scope: single })
        .from(spans)
        .select({ TraceId: spans.TraceId, SpanId: spans.SpanId })
        .where(({ oneOf }) =>
          oneOf(
            fn.tuple(spans.TraceId, spans.SpanId),
            fn.arrayZip(param.strings(["trace_1", "trace_2"]), param.strings(["span_1", "span_2"])),
          ),
        )
        .build();

      expect(statement.sql).toBe(
        "SELECT TraceId, SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND tuple(TraceId, SpanId) IN (arrayZip({v0:Array(String)}, {v1:Array(String)}))",
      );
      expect(statement.params).toMatchObject({
        v0: ["trace_1", "trace_2"],
        v1: ["span_1", "span_2"],
      });
    });
  });

  describe("when the set reads a column", () => {
    /** @scenario "A key tuple is a member of zipped bound arrays" */
    it("refuses the set: ClickHouse evaluates IN only against a constant", () => {
      const violation = refusalOf(() =>
        clickhouseRead({ scope: single })
          .from(spans)
          .select({ SpanId: spans.SpanId })
          .where(({ oneOf }) => oneOf(spans.SpanId, spans.Links)),
      );

      expect(violation).toEqual({ kind: "set-reads-a-column", column: "Links" });
    });
  });
});
