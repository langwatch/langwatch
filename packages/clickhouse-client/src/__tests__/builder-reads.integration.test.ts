/** @vitest-environment node */

/**
 * The typed builder's statements on a throwaway ClickHouse 26.8 (ADR-202), sent as a reader whose
 * row policy reads the tenant setting: each shape returns its tenant's rows, its text predicate
 * holds alone under a widened setting, and another tenant's rows never appear.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { readFileSync } from "node:fs";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  type AuthorizationInput,
  type CompiledWhere,
  honourSpanBraids,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundRows } from "../builder/bound-rows.ts";
import {
  column,
  cond,
  type Condition,
  type ConditionOps,
  type Expression,
  param,
} from "../builder/expression.ts";
import { fn } from "../builder/functions.ts";
import { clickhouseRead, type MetadataReadStatement } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { systemColumns } from "../builder/system-tables.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import {
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  testClickHouseProfilePins,
} from "../clickhouse-test-endpoints.ts";
import { idBoundOf } from "../idBound.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";
import { defineIdIndex } from "../idIndexFlags.ts";
import { windowFragment } from "../windowedRead.ts";

const DATABASE = `builder_reads_${process.pid}`;
const READER = `builder_reader_${process.pid}`;
const READER_PASSWORD = "builder-reader-test-login";
const NOW = 1_800_000_000_000;
const A = "proj_a";
const B = "proj_b";
const C = "proj_c";
const EVERY_TENANT = [A, B, C].join(",");

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
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
  },
});

/** One granule per row, so EXPLAIN shows which rows the primary key keeps. */
const pagedSpans = defineClickHouseTable({
  name: "paged_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
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
    TotalCost: column.float64(),
  },
});

const runs = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    TraceId: column.string(),
    Name: column.string(),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    Metadata: column.nullable(column.string()),
    "Messages.Id": column.array(column.string()),
    "Messages.Role": column.array(column.string()),
    "Criteria.Status": column.array(column.lowCardinality(column.string())),
  },
});

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
    ScheduledAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const rollup = defineClickHouseTable({
  name: "metrics_rollup",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    HourBucket: column.dateTime(),
    TotalCost: column.aggregateFunction({
      fn: "argMax",
      args: [column.float64(), column.dateTime64({ precision: 3 })],
    }),
    RoleCosts: column.aggregateFunction({
      fn: "argMax",
      args: [
        column.map({ key: column.string(), value: column.float64() }),
        column.dateTime64({ precision: 3 }),
      ],
    }),
    SpendNano: column.aggregateFunction({ fn: "sum", args: [column.int64()] }),
    SpanCount: column.simpleAggregate({ fn: "sum", of: column.uint64() }),
  },
});

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const span = (
  TenantId: string,
  TraceId: string,
  SpanId: string,
  SpanName: string,
  orchestrator: string,
  updatedAgo = 100,
) => ({
  TenantId,
  TraceId,
  SpanId,
  SpanName,
  StartTime: at(NOW - 500),
  UpdatedAt: at(NOW - updatedAgo),
  SpanAttributes: { orchestrator },
});
const SPANS = [
  span(A, "t0", "s0", "root-old", "web", 200),
  span(A, "t0", "s0", "root", "web"),
  span(A, "t0", "s1", "llm.call", "web"),
  span(A, "t1", "s2", "root", "api"),
  span(B, "t0", "s0", "b-root", "web"),
  span(B, "t0", "s1", "b-llm", "api"),
  span(C, "t0", "s0", "c-root", "web"),
  span(C, "t1", "s2", "c-root", "web"),
];
const summary = (TenantId: string, TraceId: string, TotalCost: number, updatedAgo = 100) => ({
  TenantId,
  TraceId,
  TotalCost,
  OccurredAt: at(NOW - 500),
  UpdatedAt: at(NOW - updatedAgo),
});
const SUMMARIES = [
  summary(A, "t0", 1),
  summary(A, "t1", 3, 200),
  summary(A, "t1", 5),
  summary(B, "t0", 100),
  summary(B, "t1", 200),
  summary(C, "t0", 1000),
];

const agents = (...named: readonly (readonly [string, string])[]) =>
  JSON.stringify({ labels: ["x", "y"], agents: named.map(([name, role]) => ({ name, role })) });
const RUNS = [
  {
    TenantId: A,
    ScenarioRunId: "r1",
    TraceId: "t0",
    Name: "  List agents!",
    UpdatedAt: at(NOW - 200),
    Metadata: agents(["Bot", "agent"], ["Ann", "user"]),
    "Messages.Id": ["m1", "m2"],
    "Messages.Role": ["user", "assistant"],
    "Criteria.Status": ["PASSED"],
  },
  {
    TenantId: A,
    ScenarioRunId: "r1",
    TraceId: "t0",
    Name: "  List agents!",
    UpdatedAt: at(NOW - 100),
    Metadata: agents(["Bot", "agent"], ["Cat", "agent"]),
    "Messages.Id": ["m1", "m2", "m3"],
    "Messages.Role": ["user", "assistant", "user"],
    "Criteria.Status": ["PASSED", "FAILED"],
  },
  {
    TenantId: A,
    ScenarioRunId: "r2",
    TraceId: "t1",
    Name: "second",
    UpdatedAt: at(NOW - 100),
    Metadata: null,
    "Messages.Id": ["m9"],
    "Messages.Role": ["assistant"],
    "Criteria.Status": [],
  },
  {
    TenantId: B,
    ScenarioRunId: "r1",
    TraceId: "t0",
    Name: "spy",
    UpdatedAt: at(NOW - 100),
    Metadata: agents(["Spy", "agent"]),
    "Messages.Id": ["b1"],
    "Messages.Role": ["user"],
    "Criteria.Status": ["PASSED"],
  },
];
const evaluation = (
  TenantId: string,
  EvaluationId: string,
  TraceId: string | null,
  Score: number | null,
  updatedAgo = 100,
) => ({
  TenantId,
  EvaluationId,
  TraceId,
  EvaluatorId: "ev_1",
  Status: Score === null ? "scheduled" : "processed",
  Score,
  ScheduledAt: at(NOW - 300),
  UpdatedAt: at(NOW - updatedAgo),
});
/** Tenant B reuses A's evaluation and trace ids, so a missing predicate or tenant join shows. */
const EVALUATIONS = [
  evaluation(A, "e1", "t0", 0.5, 200),
  evaluation(A, "e1", "t0", 0.75),
  evaluation(A, "e2", "t1", 1),
  evaluation(A, "e3", null, null),
  evaluation(B, "e1", "t0", 0.25, 50),
  evaluation(B, "e9", "t1", 0.5),
];

/** One rollup part per row: AggregateFunction states are written by -State functions. */
const ROLLUP_PARTS = [
  [A, "t0", 1.5, "map('agent', 1.0)", 10, 2, NOW - 200],
  [A, "t0", 2.5, "map('agent', 2.0, 'user', 0.5)", 5, 3, NOW - 100],
  [A, "t1", 4, "map('agent', 1.0)", 7, 1, NOW - 100],
  [B, "t0", 100, "map('agent', 50.0)", 1000, 9, NOW - 100],
] as const;

const POLICY =
  "has(arrayFilter(tenant -> notEmpty(tenant), " +
  `splitByChar(',', getSetting('${TENANT_IDS_SETTING}'))), TenantId)`;

type GrantInput = AuthorizationInput["grants"][number];
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const proofScope = (grants: GrantInput[], reads: "traces" | "spans" = "traces") =>
  tenantScope.fromProof({
    authorization: honourSpanBraids({
      authorization: sealAuthorization({
        actor: { type: "user", id: "ana" },
        principal: { type: "user", id: "ana" },
        scope: { organizationId: "org_acme" },
        grants,
        expiresAt: NOW + 30_000,
        purpose: { kind: "route", route: "traces.get" },
      }),
    }),
    reads,
    now: () => NOW,
  });
const own: GrantInput = { projectId: A, permissions: ["traces:view"], via: [], kind: "own" };
const braid: GrantInput = {
  projectId: B,
  permissions: [SPAN_BRAID_PERMISSION],
  via: ["grant_owner"],
  kind: "shared",
  condition: { type: "span", where: "compiled", compiledWhere: WEB, from: 0, until: null },
};

type Sendable = {
  sql: string;
  params: Readonly<Record<string, unknown>>;
  settings: Readonly<Record<string, unknown>>;
};

const pagedSpan = (
  TenantId: string,
  TraceId: string,
  SpanId: string,
  startAgo: number,
  updatedAgo = 100,
) => ({
  TenantId,
  TraceId,
  SpanId,
  StartTime: at(NOW - startAgo),
  UpdatedAt: at(NOW - updatedAgo),
});
const KEYS = Array.from({ length: 32 }, (_, index) => `k${String(index).padStart(2, "0")}`);
/** s1's latest version moved before the cursor at NOW - 500; its older version sits after it. */
const PAGED_SPANS = [
  pagedSpan(A, "tc", "s0", 950),
  pagedSpan(A, "tc", "s1", 100, 200),
  pagedSpan(A, "tc", "s1", 900, 100),
  pagedSpan(A, "tc", "s2", 50),
  pagedSpan(B, "tc", "s1", 100),
  ...[A, B].flatMap((tenant) => KEYS.map((key) => pagedSpan(tenant, key, "s0", 500))),
];

let container: StartedClickHouseContainer | undefined;
let admin: ClickHouseClient;
let reader: ClickHouseClient;

/** The rows a statement returns as the reader, each as sorted `value|value` text. */
async function rowsOf({
  statement,
  tenants,
}: {
  statement: Sendable;
  /** Overrides the statement's tenant setting, to show the text predicate holds alone. */
  tenants?: string;
}): Promise<string[]> {
  const settings = {
    ...statement.settings,
    ...(tenants === undefined ? {} : { [TENANT_IDS_SETTING]: tenants }),
  };
  const result = await reader.query({
    query: statement.sql,
    query_params: { ...statement.params },
    clickhouse_settings: settings as Record<string, string | number>,
    format: "JSONEachRow",
  });
  const rows = await result.json<Record<string, unknown>>();
  return rows.map((row) => Object.values(row).map(String).join("|")).toSorted();
}

const single = tenantScope.single({ tenantId: A });

/** What `EXPLAIN indexes = 1` reports for the primary key: the keys used and granules read. */
async function primaryKeyOf({ statement }: { statement: Sendable }) {
  const result = await reader.query({
    query: `EXPLAIN indexes = 1 ${statement.sql}`,
    query_params: { ...statement.params },
    clickhouse_settings: statement.settings as Record<string, string | number>,
    format: "JSONEachRow",
  });
  const lines = (await result.json<{ explain: string }>()).map((row) => row.explain.trim());
  const section = lines.slice(lines.indexOf("PrimaryKey") + 1);
  const keysEnd = section.findIndex((line) => line.startsWith("Condition:"));
  const [read = NaN, total = NaN] = (section.find((line) => line.startsWith("Granules:")) ?? "")
    .replace("Granules:", "")
    .split("/")
    .map(Number);
  return { keys: section.slice(section.indexOf("Keys:") + 1, keysEnd), granules: { read, total } };
}

/** metric_data_points as goose 00049 creates it on one node, with no storage policy. */
function metricPointsDdl(): string {
  const migration = readFileSync(
    new URL(
      "../../../clickhouse-migrations/migrations/00049_create_canonical_metrics.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const block = migration
    .split("-- +goose StatementBegin")
    .map((each) => each.split("-- +goose StatementEnd")[0] ?? "")
    .find((each) =>
      /TABLE IF NOT EXISTS \$\{CLICKHOUSE_DATABASE\}\.metric_data_points\s/.test(each),
    );
  if (block === undefined) throw new Error("goose 00049 creates metric_data_points");
  const ddl = block
    .replace(/\$\{CLICKHOUSE_DATABASE\}/g, DATABASE)
    .replace(/\$\{CLICKHOUSE_ENGINE_REPLACING_PREFIX:-([^}]*)\}/g, "$1")
    .replace(/\$\{CLICKHOUSE_STORAGE_POLICY_SETTING\}/g, "")
    .trim()
    .replace(/;$/, "");
  if (/\$\{/.test(ddl)) throw new Error("goose 00049 names a variable this test does not set");
  return ddl;
}

const metricPoints = defineClickHouseTable({
  name: "metric_data_points",
  tenantColumn: "TenantId",
  versionColumn: "DedupVersion",
  sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
  columns: {
    TenantId: column.string(),
    PointId: column.fixedString({ length: 64 }),
    SeriesId: column.fixedString({ length: 64 }),
    MetricKind: column.lowCardinalityString(),
    AggregationTemporality: column.lowCardinalityString(),
    TimeUnixNano: column.uint64(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    DedupVersion: column.uint64(),
  },
});

const SERIES_1 = "1".repeat(64);
const SERIES_2 = "2".repeat(64);
const pointIdOf = (point: number) => String(point).padStart(64, "0");
const metricPoint = (
  TenantId: string,
  SeriesId: string,
  ms: number,
  nano: number,
  point: number,
) => ({
  TenantId,
  SeriesId,
  PointId: pointIdOf(point),
  TimeUnixMs: at(NOW + ms),
  TimeUnixNano: nano,
  MetricKind: "gauge",
  AggregationTemporality: "unspecified",
  DedupVersion: 1,
});
const METRIC_POINTS = [
  metricPoint(A, SERIES_1, 100, 1, 1),
  metricPoint(A, SERIES_1, 200, 1, 2),
  metricPoint(A, SERIES_1, 200, 2, 3),
  metricPoint(A, SERIES_1, 300, 1, 4),
  metricPoint(A, SERIES_1, 400, 1, 5),
  metricPoint(A, SERIES_1, 500, 1, 6),
  metricPoint(A, SERIES_2, 100, 1, 11),
  metricPoint(A, SERIES_2, 150, 1, 12),
  metricPoint(A, SERIES_2, 300, 1, 13),
  // Tenant B reuses the series ids: each point would join a span, or win an arm, if it leaked.
  metricPoint(B, SERIES_1, 250, 1, 21),
  metricPoint(B, SERIES_1, 350, 1, 22),
  metricPoint(B, SERIES_2, 120, 1, 23),
  metricPoint(B, SERIES_2, 200, 1, 24),
];
const SEEK_SPANS = [
  { seriesId: SERIES_1, from: [100, "1", 1], to: [300, "1", 4] },
  { seriesId: SERIES_2, from: [100, "1", 11], to: [150, "1", 12] },
] as const;
const seekParams = {
  tenantId: A,
  seriesIds: SEEK_SPANS.map((span) => span.seriesId),
  fromTimes: SEEK_SPANS.map((span) => NOW + span.from[0]),
  fromNanos: SEEK_SPANS.map((span) => span.from[1]),
  fromPoints: SEEK_SPANS.map((span) => pointIdOf(span.from[2])),
  toTimes: SEEK_SPANS.map((span) => NOW + span.to[0]),
  toNanos: SEEK_SPANS.map((span) => span.to[1]),
  toPoints: SEEK_SPANS.map((span) => pointIdOf(span.to[2])),
  scanFrom: NOW + 100,
  latestSpanEnd: NOW + 300,
  earliestSpanEnd: NOW + 150,
};

/** The successor seek as the metric port writes it: bound span rows, a derived points read. */
const seekSeriesIds = param.strings(seekParams.seriesIds);
const spanRows = boundRows({
  name: "span",
  arrays: {
    SeriesId: seekSeriesIds,
    FromTime: param.int64s(seekParams.fromTimes),
    FromNano: param.strings(seekParams.fromNanos),
    FromPoint: param.strings(seekParams.fromPoints),
    ToTime: param.int64s(seekParams.toTimes),
    ToNano: param.strings(seekParams.toNanos),
    ToPoint: param.strings(seekParams.toPoints),
  },
});
const seekSpans = clickhouseRead({ scope: single })
  .from(spanRows)
  .select({
    SpanSeriesId: spanRows.SeriesId,
    SpanFromTime: fn.fromUnixTimestamp64Milli(spanRows.FromTime),
    SpanFromNano: fn.cast(spanRows.FromNano, column.uint64()),
    SpanFromPoint: spanRows.FromPoint,
    SpanToTime: fn.fromUnixTimestamp64Milli(spanRows.ToTime),
    SpanToNano: fn.cast(spanRows.ToNano, column.uint64()),
    SpanToPoint: spanRows.ToPoint,
  })
  .as("spans");
const seriesPoints = clickhouseRead({ scope: single })
  .from(metricPoints)
  .select({
    TenantId: metricPoints.TenantId,
    SeriesId: metricPoints.SeriesId,
    PointId: metricPoints.PointId,
    TimeUnixNano: metricPoints.TimeUnixNano,
    MetricKind: metricPoints.MetricKind,
    AggregationTemporality: metricPoints.AggregationTemporality,
    SeekTime: metricPoints.TimeUnixMs,
  })
  .where(({ and, gte, oneOf }) =>
    and(
      oneOf(metricPoints.SeriesId, seekSeriesIds),
      gte(metricPoints.TimeUnixMs, seekParams.scanFrom),
    ),
  )
  .as("series_points");

type SeekOps = ConditionOps<"series_points" | "spans", Record<never, never>>;
/** Ordered after or before a span end on (SeekTime, TimeUnixNano, PointId). */
function pastEnd({ ops, past, end }: { ops: SeekOps; past: "gt" | "lt"; end: "From" | "To" }) {
  const { and, eq, or } = ops;
  const beyond = ops[past];
  const [time, nano, point] =
    end === "From"
      ? [seekSpans.SpanFromTime, seekSpans.SpanFromNano, seekSpans.SpanFromPoint]
      : [seekSpans.SpanToTime, seekSpans.SpanToNano, seekSpans.SpanToPoint];
  return or(
    beyond(seriesPoints.SeekTime, time),
    and(
      eq(seriesPoints.SeekTime, time),
      or(
        beyond(seriesPoints.TimeUnixNano, nano),
        and(eq(seriesPoints.TimeUnixNano, nano), beyond(seriesPoints.PointId, point)),
      ),
    ),
  );
}
const seekOn = ({ eq }: SeekOps) =>
  eq(fn.cast(seriesPoints.SeriesId, column.string()), seekSpans.SpanSeriesId);
const seekSelection = {
  SeriesId: seriesPoints.SeriesId,
  PointId: seriesPoints.PointId,
  TimeUnixMs: fn.toUnixTimestamp64Milli(seriesPoints.SeekTime),
  TimeUnixNano: seriesPoints.TimeUnixNano,
  MetricKind: seriesPoints.MetricKind,
  AggregationTemporality: seriesPoints.AggregationTemporality,
  SeekTime: seriesPoints.SeekTime,
};
const builtSeek = () =>
  clickhouseRead({ scope: single })
    .from(seriesPoints)
    .innerJoin(seekSpans, seekOn)
    .select(seekSelection)
    .where((ops) =>
      ops.and(
        ops.lte(seriesPoints.SeekTime, seekParams.latestSpanEnd),
        pastEnd({ ops, past: "gt", end: "From" }),
        pastEnd({ ops, past: "lt", end: "To" }),
      ),
    )
    .unionAll((arm) =>
      arm
        .from(seriesPoints)
        .innerJoin(seekSpans, seekOn)
        .select(seekSelection)
        .where((ops) =>
          ops.and(
            ops.gte(seriesPoints.SeekTime, seekParams.earliestSpanEnd),
            pastEnd({ ops, past: "gt", end: "To" }),
          ),
        )
        .orderBy(seriesPoints.SeriesId)
        .orderBy(seriesPoints.SeekTime)
        .orderBy(seriesPoints.TimeUnixNano)
        .orderBy(seriesPoints.PointId)
        .limitBy(1, seriesPoints.SeriesId),
    )
    .build();

/** stored_spans' engine, ReplacingMergeTree(StartTime) (goose 00002); the version is UpdatedAt. */
const versionedSpans = defineClickHouseTable({
  name: "versioned_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
const versionedSpan = (
  TenantId: string,
  SpanId: string,
  SpanName: string,
  startAgo: number,
  updatedAgo: number,
) => ({
  TenantId,
  TraceId: "tv",
  SpanId,
  SpanName,
  StartTime: at(NOW - startAgo),
  UpdatedAt: at(NOW - updatedAgo),
});
/** s1's two latest versions share a StartTime; its stale version is the most recently updated. */
const VERSIONED_SPANS = [
  versionedSpan(A, "s1", "stale", 900, 10),
  versionedSpan(A, "s1", "first", 100, 200),
  versionedSpan(A, "s1", "second", 100, 100),
  versionedSpan(A, "s2", "only", 500, 100),
  versionedSpan(B, "s1", "other", 50, 50),
];
const builtVersioned = () =>
  clickhouseRead({ scope: single })
    .from(versionedSpans)
    .select({ SpanId: versionedSpans.SpanId, SpanName: versionedSpans.SpanName })
    .where(({ eq }) => eq(versionedSpans.TraceId, "tv"))
    .latestVersion({ version: versionedSpans.StartTime })
    .build();
/** The columns of stored_spans the signals read touches, in a table no other shape reads. */
const signalSpans = defineClickHouseTable({
  name: "signal_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
  },
});
const signalSpan = (
  TenantId: string,
  SpanId: string,
  keys: readonly string[],
  startAgo: number,
  updatedAgo = startAgo,
) => ({
  TenantId,
  TraceId: "tsig",
  SpanId,
  StartTime: at(NOW - startAgo),
  UpdatedAt: at(NOW - updatedAgo),
  SpanAttributes: Object.fromEntries(keys.map((key) => [key, "v"])),
});
const EVERY_SIGNAL_KEY = [
  "langwatch.prompt.id",
  "scenario.run_id",
  "langwatch.user_id",
  "langgraph.thread_id",
  "langwatch.evaluation.passed",
  "langwatch.rag.contexts",
  "langwatch.metadata.k",
  "gen_ai.system",
];
/** s7's latest version holds no signal key, its older one a prompt; B reuses s5 with every key. */
const SIGNAL_SPANS = [
  signalSpan(A, "s1", ["langwatch.prompt.id", "gen_ai.request.model"], 900),
  signalSpan(A, "s2", ["scenario.run_id", "service.name"], 800),
  signalSpan(A, "s3", ["langwatch.user_id", "langwatch.thread.id"], 700),
  signalSpan(A, "s4", ["gen_ai.conversation.id"], 600),
  signalSpan(A, "s5", ["service.name"], 500),
  signalSpan(
    A,
    "s6",
    [
      "langwatch.scenario.id",
      "langwatch.user.email",
      "langgraph.thread_id",
      "langwatch.evaluation.passed",
      "langwatch.rag.contexts",
      "langwatch.metadata.k",
    ],
    400,
  ),
  signalSpan(A, "s7", ["langwatch.prompt.id"], 300, 300),
  signalSpan(A, "s7", ["service.name"], 300, 100),
  signalSpan(B, "s5", EVERY_SIGNAL_KEY, 500, 10),
  signalSpan(B, "s9", EVERY_SIGNAL_KEY, 50),
];

type SignalKeys = Expression<readonly string[], "span_keys">;
const prefixed = (prefix: string) => (keys: SignalKeys) =>
  fn.arrayExists((key) => fn.startsWith(key, prefix), keys);
/** The LangWatch signal buckets: each bucket's name and the condition on a span's keys. */
const SIGNAL_BUCKETS: readonly (readonly [string, (keys: SignalKeys) => Condition<"span_keys">])[] =
  [
    ["prompt", prefixed("langwatch.prompt.")],
    [
      "scenario",
      (keys) =>
        fn.arrayExists(
          (key) =>
            cond.or(fn.startsWith(key, "langwatch.scenario."), cond.eq(key, "scenario.run_id")),
          keys,
        ),
    ],
    [
      "user",
      (keys) =>
        fn.arrayExists(
          (key) =>
            cond.or(cond.eq(key, "langwatch.user_id"), fn.startsWith(key, "langwatch.user.")),
          keys,
        ),
    ],
    [
      "thread",
      (keys) =>
        fn.arrayExists(
          (key) =>
            cond.or(
              cond.eq(key, "gen_ai.conversation.id"),
              cond.eq(key, "langgraph.thread_id"),
              fn.startsWith(key, "langwatch.thread."),
            ),
          keys,
        ),
    ],
    ["evaluation", prefixed("langwatch.evaluation")],
    ["rag", prefixed("langwatch.rag.")],
    ["metadata", prefixed("langwatch.metadata.")],
    ["genai", prefixed("gen_ai.")],
  ];
function builtSignals() {
  const spanKeys = clickhouseRead({ scope: single })
    .from(signalSpans)
    .select({ SpanId: signalSpans.SpanId, keys: fn.mapKeys(signalSpans.SpanAttributes) })
    .where(({ eq }) => eq(signalSpans.TraceId, "tsig"))
    .latestVersion()
    .orderBy(signalSpans.StartTime)
    .limit(10_000)
    .as("span_keys");
  return clickhouseRead({ scope: single })
    .from(spanKeys)
    .select({
      SpanId: spanKeys.SpanId,
      Signals: fn.arrayFilter(
        (signal) => cond.ne(signal, ""),
        fn.array(
          ...SIGNAL_BUCKETS.map(([bucket, has]) =>
            fn.if(has(spanKeys.keys), param.string(bucket), ""),
          ),
        ),
      ),
    })
    .build();
}

/** Nested columns, AggregateFunction merges, lambdas and casts. */
const CENSUS_SHAPES: Record<string, { statement: () => Sendable; rows: string[] }> = {
  "nested columns on the latest version": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(runs)
        .latestVersion()
        .select({
          run: runs.ScenarioRunId,
          first: fn.arraySlice(runs["Messages.Id"], 1, 1),
          messages: fn.length(runs["Messages.Role"]),
          passed: fn.has(runs["Criteria.Status"], "PASSED"),
        })
        .build(),
    rows: ["r1|m1|3|1", "r2|m9|1|0"],
  },
  "a nested column read through a join side": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(spans)
        .innerJoin(runs, ({ eq }) => eq(runs.TraceId, spans.TraceId), { latestVersion: true })
        .latestVersion()
        .select({ span: spans.SpanId, messages: fn.length(runs["Messages.Role"]) })
        .build(),
    rows: ["s0|3", "s1|3", "s2|1"],
  },
  "AggregateFunction states merged, under a DateTime range": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(rollup)
        .select({
          trace: rollup.TraceId,
          cost: fn.argMaxMerge(rollup.TotalCost),
          spend: fn.sumMerge(rollup.SpendNano),
          spans: fn.sum(rollup.SpanCount),
        })
        .where(({ range }) =>
          range(rollup.HourBucket, { from: NOW - 3_600_000, until: NOW + 3_600_000 }),
        )
        .groupBy(rollup.TraceId)
        .build(),
    rows: ["t0|2.5|15|5", "t1|4|7|1"],
  },
  "a merged map state summed per key over a derived table": {
    statement: () => {
      const latest = clickhouseRead({ scope: single })
        .from(rollup)
        .select({ trace: rollup.TraceId, roles: fn.argMaxMerge(rollup.RoleCosts) })
        .groupBy(rollup.TraceId)
        .as("latest");
      const summed = fn.sumMap(fn.mapKeys(latest.roles), fn.mapValues(latest.roles));
      return clickhouseRead({ scope: single })
        .from(latest)
        .select({
          roles: fn.toString(
            fn.mapFromArrays(fn.tupleElement(summed, "0"), fn.tupleElement(summed, "1")),
          ),
        })
        .build();
    },
    rows: ["{'agent':3,'user':0.5}"],
  },
  "lambdas over JSON arrays and over two nested arrays": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(runs)
        .latestVersion()
        .select(({ and, eq }) => ({
          run: runs.ScenarioRunId,
          agents: fn.arrayStringConcat(
            fn.arrayMap(
              (agent) => fn.JSONExtractString(agent, "name"),
              fn.arrayFilter(
                (agent) => eq(fn.JSONExtractString(agent, "role"), "agent"),
                fn.JSONExtractArrayRaw(fn.ifNull(runs.Metadata, "{}"), "agents"),
              ),
            ),
            " vs ",
          ),
          asked: fn.arrayExists(
            (id, role) => and(eq(role, "user"), eq(id, "m3")),
            runs["Messages.Id"],
            runs["Messages.Role"],
          ),
        }))
        .build(),
    rows: ["r1|Bot vs Cat|1", "r2||0"],
  },
  "bound patterns, types, formats, units and zones, casts and a held default": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(runs)
        .latestVersion()
        .select({
          run: runs.ScenarioRunId,
          slug: fn.trimBoth(
            fn.replaceRegexpAll(fn.lowerUTF8(runs.Name), "[^\\p{L}\\p{N}]+", "-"),
            "-",
          ),
          labels: fn.JSONExtract(
            fn.ifNull(runs.Metadata, "{}"),
            column.array(column.string()),
            "labels",
          ),
          day: fn.formatDateTime(runs.UpdatedAt, "%Y-%m-%d", "UTC"),
          lag: fn.dateDiff("second", runs.UpdatedAt, param.epochMs(NOW + 4_900)),
          week: fn.toStartOfWeek(runs.UpdatedAt, { mode: 1, timeZone: "UTC" }),
          nothing: fn.nullAs(column.nullable(column.string())),
          none: fn.emptyArrayAs(column.array(column.string())),
          held: fn.heldOr(runs["Criteria.Status"], {
            holds: () => false,
            otherwise: fn.emptyArrayAs(column.array(column.lowCardinality(column.string()))),
          }),
        })
        .where(({ eq }) => eq(runs.ScenarioRunId, "r1"))
        .build(),
    rows: ["r1|list-agents|x,y|2027-01-15|5|2027-01-11|null||"],
  },
};

/** Each shape and the exact rows tenant A gets; none names another tenant's values. */
const SHAPES: Record<string, { statement: () => Sendable; rows: string[] }> = {
  "a join with the latest version on both sides": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(summaries)
        .innerJoin(spans, ({ eq }) => eq(spans.TraceId, summaries.TraceId), {
          latestVersion: true,
        })
        .latestVersion()
        .select({ traceId: summaries.TraceId, name: spans.SpanName, cost: summaries.TotalCost })
        .build(),
    rows: ["t0|llm.call|1", "t0|root|1", "t1|root|5"],
  },
  "a common table expression": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(spans)
        .with("costly", (sub) =>
          sub
            .from(summaries)
            .select({ TraceId: summaries.TraceId })
            .where(({ gt }) => gt(summaries.TotalCost, 2)),
        )
        .select({ SpanId: spans.SpanId })
        .where(({ oneOf }) => oneOf(spans.TraceId, { cte: "costly" }))
        .build(),
    rows: ["s2"],
  },
  "an ordered, limited UNION ALL with WITH in an arm": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(summaries)
        .latestVersion()
        .select({ traceId: summaries.TraceId, cost: summaries.TotalCost })
        .unionAll((arm) =>
          arm
            .from(spans)
            .with("calls", (sub) =>
              sub
                .from(spans)
                .select({ SpanId: spans.SpanId })
                .where(({ eq }) => eq(spans.SpanName, "llm.call")),
            )
            .select({ traceId: spans.TraceId, cost: fn.toFloat64(fn.count()) })
            .where(({ oneOf }) => oneOf(spans.SpanId, { cte: "calls" }))
            .groupBy(spans.TraceId)
            .orderBy("cost", "DESC")
            .limit(1),
        )
        .orderBy("cost", "DESC")
        .limit(2)
        .build(),
    rows: ["t0|1", "t1|5"],
  },
  FINAL: {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(summaries)
        .final()
        .select({ TraceId: summaries.TraceId, TotalCost: summaries.TotalCost })
        .build(),
    rows: ["t0|1", "t1|5"],
  },
  "the latest version in PREWHERE": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(summaries)
        .latestVersion({ prewhere: true })
        .select({ TraceId: summaries.TraceId, TotalCost: summaries.TotalCost })
        .build(),
    rows: ["t0|1", "t1|5"],
  },
  "an argMax collapse over a derived table": {
    statement: () => {
      const latest = clickhouseRead({ scope: single })
        .from(summaries)
        .select({
          TraceId: summaries.TraceId,
          __latest: fn.argMax(fn.tuple(summaries.TotalCost), summaries.UpdatedAt),
        })
        .groupBy(summaries.TenantId, summaries.TraceId)
        .as("latest");
      return clickhouseRead({ scope: single })
        .from(latest)
        .select({ TraceId: latest.TraceId, TotalCost: fn.tupleElement(latest.__latest, "0") })
        .where(({ gt }) => gt(fn.tupleElement(latest.__latest, "0"), param.float64(0)))
        .build();
    },
    rows: ["t0|1", "t1|5"],
  },
  "a proof's windows": {
    statement: () =>
      clickhouseRead({ scope: proofScope([own]) })
        .from(spans)
        .withinWindows()
        .distinct()
        .select({ TenantId: spans.TenantId, SpanId: spans.SpanId })
        .build(),
    rows: [`${A}|s0`, `${A}|s1`, `${A}|s2`],
  },
  "a braided read": {
    statement: () =>
      clickhouseRead({ scope: proofScope([own, braid], "spans") })
        .from(spans)
        .braided()
        .distinct()
        .select({ TenantId: spans.TenantId, SpanId: spans.SpanId })
        .build(),
    rows: [`${A}|s0`, `${A}|s1`, `${A}|s2`, `${B}|s0`],
  },
};

/** The statement with its id markers expanded as the client expands them for one window. */
function windowed({ statement, key }: { statement: Sendable; key: string }): Sendable {
  const declaration = defineIdIndex({ source: "evaluation_runs", key: [key], time: "ScheduledAt" });
  const registry = { declarationOf: () => declaration, declarations: () => [declaration] };
  const bound = idBoundOf({ sql: statement.sql, params: { ...statement.params }, registry });
  if (bound === null) throw new Error("the shape carries an idBound marker");
  return { ...statement, ...bound.render(windowFragment({ fromMs: NOW - 60_000, toMs: NOW })) };
}

/** Nullable and listed ids, derived joins, chained CTEs and scalar subqueries. */
const JOIN_AND_SUBQUERY_SHAPES: Record<string, { statement: () => Sendable; rows: string[] }> = {
  "a list of ids bounding a nullable id column": {
    statement: () =>
      windowed({
        key: "TraceId",
        statement: clickhouseRead({ scope: single })
          .from(evaluations)
          .latestVersion()
          .select({ EvaluationId: evaluations.EvaluationId, Score: evaluations.Score })
          .where(({ idBound }) => idBound(evaluations.TraceId, ["t0", "t1"]))
          .build(),
      }),
    rows: ["e1|0.75", "e2|1"],
  },
  "a join of two derived reads by day in a time zone": {
    statement: () => {
      const traces = clickhouseRead({ scope: single })
        .from(summaries)
        .select({
          TenantId: summaries.TenantId,
          TraceId: summaries.TraceId,
          TraceOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
        })
        .where(({ gte }) => gte(summaries.OccurredAt, NOW - 60_000))
        .groupBy(summaries.TenantId, summaries.TraceId)
        .as("traces");
      const latest = clickhouseRead({ scope: single })
        .from(evaluations)
        .select({
          TenantId: evaluations.TenantId,
          Latest: fn.argMax(
            fn.tuple(evaluations.TraceId, evaluations.Status, evaluations.Score),
            evaluations.UpdatedAt,
          ),
        })
        .where(({ oneOf }) => oneOf(evaluations.EvaluatorId, ["ev_1"]))
        .groupBy(evaluations.TenantId, evaluations.EvaluationId)
        .as("latest");
      const scored = clickhouseRead({ scope: single })
        .from(latest)
        .select({
          TenantId: latest.TenantId,
          TraceId: fn.tupleElement(latest.Latest, "0"),
          Status: fn.tupleElement(latest.Latest, "1"),
          Score: fn.tupleElement(latest.Latest, "2"),
        })
        .as("scored");
      const day = fn.toString(
        fn.toStartOfDay(traces.TraceOccurredAt, { timeZone: "America/Los_Angeles" }),
      );
      return clickhouseRead({ scope: single })
        .from(traces)
        .innerJoin(scored, ({ eq }) => eq(scored.TraceId, traces.TraceId))
        .select({ Day: day, ScoreSum: fn.sum(scored.Score), ScoreCount: fn.count() })
        .where(({ eq }) => eq(scored.Status, param.string("processed")))
        .groupBy(day)
        .build();
    },
    rows: ["2027-01-14 00:00:00|1.75|2"],
  },
  "a CTE reading an earlier CTE": {
    statement: () =>
      clickhouseRead({ scope: single })
        .from(evaluations)
        .with("traced", (sub) => sub.from(summaries).select({ TraceId: summaries.TraceId }))
        .with("scored", (sub) =>
          sub
            .from(evaluations)
            .select({ EvaluationId: evaluations.EvaluationId })
            .where(({ oneOf }) => oneOf(fn.ifNull(evaluations.TraceId, ""), { cte: "traced" })),
        )
        .distinct()
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ oneOf }) => oneOf(evaluations.EvaluationId, { cte: "scored" }))
        .build(),
    rows: ["e1", "e2"],
  },
  "a scalar subquery electing the latest version by id": {
    statement: () =>
      windowed({
        key: "EvaluationId",
        statement: clickhouseRead({ scope: single })
          .from(evaluations)
          .select({ Score: evaluations.Score })
          .where(({ and, eq, idBound, scalar }) =>
            and(
              idBound(evaluations.EvaluationId, "e1"),
              eq(
                evaluations.UpdatedAt,
                scalar((sub) =>
                  sub
                    .from(evaluations)
                    .select({ v: fn.max(evaluations.UpdatedAt) })
                    .where(({ idBound: inner }) => inner(evaluations.EvaluationId, "e1")),
                ),
              ),
            ),
          )
          .limit(1)
          .build(),
      }),
    rows: ["0.75"],
  },
};

/** An election repeating an id bound, and a JSON path from a lambda's parameter. */
const ID_BOUND_AND_JSON_SHAPES: Record<string, { statement: () => Sendable; rows: string[] }> = {
  "a latest-version election repeating an id bound outside the sort key": {
    statement: () =>
      windowed({
        key: "TraceId",
        statement: clickhouseRead({ scope: single })
          .from(evaluations)
          .latestVersion()
          .select({ EvaluationId: evaluations.EvaluationId, Score: evaluations.Score })
          .where(({ idBound }) => idBound(evaluations.TraceId, "t0"))
          .build(),
      }),
    rows: ["e1|0.75"],
  },
  "a JSON path keyed by a lambda's parameter": {
    statement: () => {
      const metadata = fn.ifNull(runs.Metadata, "{}");
      return clickhouseRead({ scope: single })
        .from(runs)
        .latestVersion()
        .select({
          ScenarioRunId: runs.ScenarioRunId,
          Raw: fn.arrayMap((key) => fn.JSONExtractRaw(metadata, key), fn.JSONExtractKeys(metadata)),
        })
        .build();
    },
    rows: [`r1|["x","y"],[{"name":"Bot","role":"agent"},{"name":"Cat","role":"agent"}]`, "r2|"],
  },
};

describe("given builder statements sent as a reader under a row policy on ClickHouse 26.8", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withEnvironment({ CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1" })
      .withCopyContentToContainer([TEST_CLICKHOUSE_TUNING, pins.file])
      .withStartupTimeout(120_000)
      .start();
    const url = container.getHttpUrl();
    admin = createClient({
      url,
      username: container.getUsername(),
      password: container.getPassword(),
    });
    for (const query of [
      `CREATE DATABASE IF NOT EXISTS ${DATABASE}`,
      `CREATE TABLE ${DATABASE}.stored_spans (TenantId String, TraceId String, SpanId String,
         SpanName String, StartTime DateTime64(9), UpdatedAt DateTime64(3),
         SpanAttributes Map(String, String)) ENGINE = ReplacingMergeTree(UpdatedAt)
         ORDER BY (TenantId, TraceId, SpanId)`,
      `CREATE TABLE ${DATABASE}.trace_summaries (TenantId String, TraceId String,
         OccurredAt DateTime64(3), UpdatedAt DateTime64(3), TotalCost Float64)
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId)`,
      `CREATE USER ${READER} IDENTIFIED WITH plaintext_password BY '${READER_PASSWORD}'`,
      `CREATE SETTINGS PROFILE ${READER}_profile SETTINGS ${TENANT_IDS_SETTING} = '' TO ${READER}`,
      `GRANT SELECT ON ${DATABASE}.* TO ${READER}`,
      `CREATE ROW POLICY ${READER}_spans ON ${DATABASE}.stored_spans USING ${POLICY} TO ${READER}`,
      `CREATE ROW POLICY ${READER}_summaries ON ${DATABASE}.trace_summaries USING ${POLICY} TO ${READER}`,
      `CREATE TABLE ${DATABASE}.simulation_runs (TenantId String, ScenarioRunId String,
         TraceId String, Name String, UpdatedAt DateTime64(3), Metadata Nullable(String),
         Messages Nested(Id String, Role String), \`Criteria.Status\` Array(LowCardinality(String)))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, ScenarioRunId)`,
      `CREATE TABLE ${DATABASE}.metrics_rollup (TenantId String, TraceId String,
         HourBucket DateTime, TotalCost AggregateFunction(argMax, Float64, DateTime64(3)),
         RoleCosts AggregateFunction(argMax, Map(String, Float64), DateTime64(3)),
         SpendNano AggregateFunction(sum, Int64), SpanCount SimpleAggregateFunction(sum, UInt64))
         ENGINE = AggregatingMergeTree ORDER BY (TenantId, TraceId)`,
      `CREATE ROW POLICY ${READER}_runs ON ${DATABASE}.simulation_runs USING ${POLICY} TO ${READER}`,
      `CREATE ROW POLICY ${READER}_rollup ON ${DATABASE}.metrics_rollup USING ${POLICY} TO ${READER}`,
      `CREATE TABLE ${DATABASE}.evaluation_runs (TenantId String, EvaluationId String,
         TraceId Nullable(String), EvaluatorId String, Status String, Score Nullable(Float64),
         ScheduledAt DateTime64(3), UpdatedAt DateTime64(3))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, EvaluationId)`,
      `CREATE ROW POLICY ${READER}_evaluations ON ${DATABASE}.evaluation_runs USING ${POLICY} TO ${READER}`,
      `CREATE TABLE ${DATABASE}.paged_spans (TenantId String, TraceId String, SpanId String,
         StartTime DateTime64(9), UpdatedAt DateTime64(3)) ENGINE = ReplacingMergeTree(UpdatedAt)
         ORDER BY (TenantId, TraceId, SpanId) SETTINGS index_granularity = 1`,
      `CREATE ROW POLICY ${READER}_paged ON ${DATABASE}.paged_spans USING ${POLICY} TO ${READER}`,
      `SYSTEM STOP MERGES ${DATABASE}.paged_spans`,
      metricPointsDdl(),
      `CREATE ROW POLICY ${READER}_metric_points ON ${DATABASE}.metric_data_points USING ${POLICY} TO ${READER}`,
      `CREATE TABLE ${DATABASE}.versioned_spans (TenantId String, TraceId String, SpanId String,
         SpanName String, StartTime DateTime64(9), UpdatedAt DateTime64(3))
         ENGINE = ReplacingMergeTree(StartTime) ORDER BY (TenantId, TraceId, SpanId)`,
      `CREATE ROW POLICY ${READER}_versioned ON ${DATABASE}.versioned_spans USING ${POLICY} TO ${READER}`,
      `SYSTEM STOP MERGES ${DATABASE}.versioned_spans`,
      `CREATE TABLE ${DATABASE}.signal_spans (TenantId String, TraceId String, SpanId String,
         StartTime DateTime64(9), UpdatedAt DateTime64(3), SpanAttributes Map(String, String))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId, SpanId)`,
      `CREATE ROW POLICY ${READER}_signals ON ${DATABASE}.signal_spans USING ${POLICY} TO ${READER}`,
      `SYSTEM STOP MERGES ${DATABASE}.signal_spans`,
      ...ROLLUP_PARTS.map(
        ([tenant, trace, cost, roles, spend, count, ms]) =>
          `INSERT INTO ${DATABASE}.metrics_rollup SELECT '${tenant}', '${trace}',
             toDateTime(${NOW / 1000}), argMaxState(toFloat64(${cost}), toDateTime64(${ms / 1000}, 3)),
             argMaxState(${roles}, toDateTime64(${ms / 1000}, 3)), sumState(toInt64(${spend})),
             toUInt64(${count})`,
      ),
    ]) {
      await admin.command({ query });
    }
    await admin.insert({
      table: `${DATABASE}.stored_spans`,
      values: SPANS,
      format: "JSONEachRow",
    });
    await admin.insert({
      table: `${DATABASE}.trace_summaries`,
      values: SUMMARIES,
      format: "JSONEachRow",
    });
    await admin.insert({
      table: `${DATABASE}.simulation_runs`,
      values: RUNS,
      format: "JSONEachRow",
    });
    await admin.insert({
      table: `${DATABASE}.evaluation_runs`,
      values: EVALUATIONS,
      format: "JSONEachRow",
    });
    // Both versions of s1 stay as rows: no merge, and no insert-time dedup.
    await admin.insert({
      table: `${DATABASE}.paged_spans`,
      values: PAGED_SPANS,
      format: "JSONEachRow",
      clickhouse_settings: { optimize_on_insert: 0 },
    });
    await admin.insert({
      table: `${DATABASE}.metric_data_points`,
      values: METRIC_POINTS,
      format: "JSONEachRow",
    });
    // Every version of s1 stays a row, as on a replica before its merge.
    await admin.insert({
      table: `${DATABASE}.versioned_spans`,
      values: VERSIONED_SPANS,
      format: "JSONEachRow",
      clickhouse_settings: { optimize_on_insert: 0 },
    });
    await admin.insert({
      table: `${DATABASE}.signal_spans`,
      values: SIGNAL_SPANS,
      format: "JSONEachRow",
      clickhouse_settings: { optimize_on_insert: 0 },
    });
    reader = createClient({ url, username: READER, password: READER_PASSWORD, database: DATABASE });
  }, 300_000);

  afterAll(async () => {
    await reader?.close();
    await admin?.close();
    await container?.stop();
  }, 60_000);

  for (const [name, shape] of Object.entries(SHAPES)) {
    describe(`when ${name} is built and sent`, () => {
      /** @scenario "Built statements return their tenant's rows under the reader's row policy on 26.8" */
      it("returns exactly its tenant's rows", async () => {
        expect(await rowsOf({ statement: shape.statement() })).toEqual(shape.rows);
      });

      /** @scenario "Built statements return their tenant's rows under the reader's row policy on 26.8" */
      it("keeps another tenant's rows out by its own text when the setting lists every tenant", async () => {
        expect(await rowsOf({ statement: shape.statement(), tenants: EVERY_TENANT })).toEqual(
          shape.rows,
        );
      });
    });
  }

  for (const [name, shape] of Object.entries(CENSUS_SHAPES)) {
    describe(`when ${name} is built and sent`, () => {
      /** @scenario "Nested columns, AggregateFunction merges, lambdas and bound constants run on 26.8" */
      it("returns exactly its tenant's rows", async () => {
        expect(await rowsOf({ statement: shape.statement() })).toEqual(shape.rows);
      });

      /** @scenario "Nested columns, AggregateFunction merges, lambdas and bound constants run on 26.8" */
      it("keeps another tenant's rows out by its own text when the setting lists every tenant", async () => {
        expect(await rowsOf({ statement: shape.statement(), tenants: EVERY_TENANT })).toEqual(
          shape.rows,
        );
      });
    });
  }

  for (const [name, shape] of Object.entries(JOIN_AND_SUBQUERY_SHAPES)) {
    describe(`when ${name} is built and sent`, () => {
      /** @scenario "Nullable and listed ids, derived joins, chained CTEs and scalar subqueries run on 26.8" */
      it("returns exactly its tenant's rows", async () => {
        expect(await rowsOf({ statement: shape.statement() })).toEqual(shape.rows);
      });

      /** @scenario "Nullable and listed ids, derived joins, chained CTEs and scalar subqueries run on 26.8" */
      it("keeps another tenant's rows out by its own text when the setting lists every tenant", async () => {
        expect(await rowsOf({ statement: shape.statement(), tenants: EVERY_TENANT })).toEqual(
          shape.rows,
        );
      });
    });
  }

  for (const [name, shape] of Object.entries(ID_BOUND_AND_JSON_SHAPES)) {
    describe(`when ${name} is built and sent`, () => {
      /** @scenario "A repeated id bound and a JSON path from a lambda's parameter run on 26.8" */
      it("returns exactly its tenant's rows", async () => {
        expect(await rowsOf({ statement: shape.statement() })).toEqual(shape.rows);
      });

      /** @scenario "A repeated id bound and a JSON path from a lambda's parameter run on 26.8" */
      it("keeps another tenant's rows out by its own text when the setting lists every tenant", async () => {
        expect(await rowsOf({ statement: shape.statement(), tenants: EVERY_TENANT })).toEqual(
          shape.rows,
        );
      });
    });
  }

  describe("when a span page's cursor is kept out of the election", () => {
    const page = (options: { inElection: boolean }) =>
      clickhouseRead({ scope: single })
        .from(pagedSpans)
        .latestVersion()
        .select({ SpanId: pagedSpans.SpanId })
        .where(({ eq }) => eq(pagedSpans.TraceId, "tc"))
        .where(
          ({ gt }) =>
            gt(
              fn.tuple(pagedSpans.StartTime, pagedSpans.SpanId),
              fn.tuple(param.epochMs(NOW - 500), param.string("")),
            ),
          options,
        )
        .build();

    /** @scenario "An outer-only cursor and zipped tuple membership run on 26.8 as main's reads do" */
    it("leaves off the span whose latest version moved before the cursor", async () => {
      expect(await rowsOf({ statement: page({ inElection: false }) })).toEqual(["s2"]);
    });

    /** @scenario "An outer-only cursor and zipped tuple membership run on 26.8 as main's reads do" */
    it("returns that span's stale version when the cursor is repeated in the election", async () => {
      expect(await rowsOf({ statement: page({ inElection: true }) })).toEqual(["s1", "s2"]);
    });
  });

  describe("when span keys are looked up as a tuple in zipped bound arrays", () => {
    const traceIds = ["k03", "k07", "k07"];
    const spanIds = ["s0", "s0", "s9"];
    const built = () =>
      clickhouseRead({ scope: single })
        .from(pagedSpans)
        .select({ TraceId: pagedSpans.TraceId, SpanId: pagedSpans.SpanId })
        .where(({ oneOf }) =>
          oneOf(
            fn.tuple(pagedSpans.TraceId, pagedSpans.SpanId),
            fn.arrayZip(param.strings(traceIds), param.strings(spanIds)),
          ),
        )
        .build();
    /** @scenario "An outer-only cursor and zipped tuple membership run on 26.8 as main's reads do" */
    it("returns exactly its tenant's keys, also when the setting lists every tenant", async () => {
      expect(await rowsOf({ statement: built() })).toEqual(["k03|s0", "k07|s0"]);
      expect(await rowsOf({ statement: built(), tenants: EVERY_TENANT })).toEqual([
        "k03|s0",
        "k07|s0",
      ]);
    });

    /** @scenario "An outer-only cursor and zipped tuple membership run on 26.8 as main's reads do" */
    it("prunes the primary key on TraceId and SpanId to the granules main's raw form read", async () => {
      const ours = await primaryKeyOf({ statement: built() });

      // Main's `(TraceId, SpanId) IN arrayZip(...)` read 4 of 69 granules on these rows.
      expect(ours).toEqual({
        keys: ["TenantId", "TraceId", "SpanId"],
        granules: { read: 4, total: 69 },
      });
      expect(ours.granules.read).toBeLessThan(ours.granules.total / 4);
    });
  });

  describe("when the metric successor seek is built from bound span rows and sent", () => {
    /** @scenario "The metric successor seek runs on 26.8 as main's raw query does" */
    it("returns each series' points inside a span and its first point past the span", async () => {
      const built = builtSeek();
      const point = (series: string, id: number, ms: number) =>
        `${series}|${pointIdOf(id)}|${NOW + ms}|${id === 3 ? 2 : 1}|gauge|unspecified|${at(NOW + ms)}`;
      const expected = [
        point(SERIES_1, 2, 200),
        point(SERIES_1, 3, 200),
        point(SERIES_1, 5, 400),
        point(SERIES_2, 13, 300),
      ];

      expect(await rowsOf({ statement: built })).toEqual(expected);
      expect(await rowsOf({ statement: built, tenants: EVERY_TENANT })).toEqual(expected);
    });
  });

  describe("when a read elects on StartTime, the column its engine replaces by", () => {
    /** @scenario "An election on a named version column runs on 26.8 as main's read does" */
    it("returns both versions sharing the latest StartTime", async () => {
      const expected = ["s1|first", "s1|second", "s2|only"];

      expect(await rowsOf({ statement: builtVersioned() })).toEqual(expected);
      expect(await rowsOf({ statement: builtVersioned(), tenants: EVERY_TENANT })).toEqual(
        expected,
      );
    });
  });

  describe("when trace's LangWatch signals read is built from an array literal and conditions", () => {
    /** @scenario "Trace's LangWatch signals read runs on 26.8 as main's raw query does" */
    it("returns each latest span's signal buckets, also when the setting lists every tenant", async () => {
      const built = builtSignals();
      const expected = [
        "s1|prompt,genai",
        "s2|scenario",
        "s3|user,thread",
        "s4|thread,genai",
        "s5|",
        "s6|scenario,user,thread,evaluation,rag,metadata",
        "s7|",
      ];

      expect(await rowsOf({ statement: built })).toEqual(expected);
      expect(await rowsOf({ statement: built, tenants: EVERY_TENANT })).toEqual(expected);
    });
  });

  describe("when tenant A's statement goes out under tenant B's setting", () => {
    /** @scenario "Built statements return their tenant's rows under the reader's row policy on 26.8" */
    it("returns no rows: the policy and the text predicate both apply", async () => {
      const statement = SHAPES["a join with the latest version on both sides"]?.statement();
      if (statement === undefined) throw new Error("the join shape is declared above");
      expect(await rowsOf({ statement, tenants: B })).toEqual([]);
    });
  });

  describe("when a server-metadata read is sent", () => {
    /** @scenario "A server-metadata read runs on 26.8 with no tenant setting" */
    it("reads the allow-listed system table with no tenant setting", async () => {
      const metadata = tenantScope.serverMetadata({ reason: "builder integration column list" });
      const columns: MetadataReadStatement = clickhouseRead({ scope: metadata })
        .from(systemColumns)
        .select({ name: systemColumns.name })
        .where(({ and, eq }) =>
          and(
            eq(systemColumns.database, fn.currentDatabase()),
            eq(systemColumns.table, "trace_summaries"),
          ),
        )
        .build();
      const one = clickhouseRead({ scope: metadata })
        .withoutTable()
        .select({ one: param.uint32(1) })
        .build();

      expect(columns.settings).not.toHaveProperty(TENANT_IDS_SETTING);
      expect(await rowsOf({ statement: columns })).toEqual([
        "OccurredAt",
        "TenantId",
        "TotalCost",
        "TraceId",
        "UpdatedAt",
      ]);
      expect(await rowsOf({ statement: one })).toEqual(["1"]);
    });
  });
});
