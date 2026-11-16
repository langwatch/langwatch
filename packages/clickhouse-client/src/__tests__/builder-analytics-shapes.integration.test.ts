/** @vitest-environment node */

/**
 * The analytics and trace-filter builder shapes on a throwaway ClickHouse 26.8, sent as a reader
 * whose row policy reads the tenant setting: each returns the rows main returned on 26.8 (kept as
 * literals), with another tenant's rows present and the setting widened to every tenant.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { column, param } from "../builder/expression.ts";
import { fn } from "../builder/functions.ts";
import { clickhouseRead } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import {
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  testClickHouseProfilePins,
} from "../clickhouse-test-endpoints.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";

const DATABASE = `analytics_shapes_${process.pid}`;
const READER = `analytics_shapes_reader_${process.pid}`;
const READER_PASSWORD = "analytics-shapes-reader-test-login";
const A = "proj_a";
const B = "proj_b";
const EVERY_TENANT = [A, B].join(",");
/** 2027-01-15 10:47:31.250 UTC, so zoned and epoch-aligned buckets differ. */
const NOW = 1_800_009_000_000 + 31_250;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const POLICY =
  "has(arrayFilter(tenant -> notEmpty(tenant), " +
  `splitByChar(',', getSetting('${TENANT_IDS_SETTING}'))), TenantId)`;
const CONTEXTS = "langwatch.rag.contexts";

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

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
    Durations: column.array(column.float64()),
    SpanAttributes: column.stringMap(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const SUMMARIES = [A, B].flatMap((TenantId) =>
  ["t1", "t2", "t3", "t4"].map((TraceId) => ({
    TenantId,
    TraceId,
    OccurredAt: at(NOW),
    UpdatedAt: at(NOW),
  })),
);

const span = ({
  tenant,
  trace,
  id,
  name,
  startMs = NOW,
  durations = [1],
  attributes = {},
}: {
  tenant: string;
  trace: string;
  id: string;
  name: string;
  startMs?: number;
  durations?: number[];
  attributes?: Record<string, string>;
}) => ({
  TenantId: tenant,
  TraceId: trace,
  SpanId: id,
  SpanName: name,
  Durations: durations,
  SpanAttributes: attributes,
  StartTime: at(startMs),
  UpdatedAt: at(NOW),
});

/** A's llm spans on t1 and t3, tool spans on t3 and t4; B's llm spans on t1 and t2. */
const SPANS = [
  span({
    tenant: A,
    trace: "t1",
    id: "s1",
    name: "llm",
    durations: [5, 10, 40],
    attributes: {
      tokens: "12",
      [CONTEXTS]: '[{"document_id":"d1","content":"x"},{"document_id":7,"content":"y"}]',
    },
  }),
  span({
    tenant: A,
    trace: "t3",
    id: "s2",
    name: "llm",
    startMs: NOW + DAY + 5 * HOUR,
    durations: [7],
    attributes: { tokens: "12.5" },
  }),
  span({
    tenant: A,
    trace: "t3",
    id: "s3",
    name: "tool",
    startMs: NOW + 3 * DAY,
    attributes: { tokens: "x" },
  }),
  span({ tenant: A, trace: "t4", id: "s4", name: "tool", startMs: NOW - 2 * HOUR }),
  span({
    tenant: B,
    trace: "t1",
    id: "s5",
    name: "llm",
    durations: [1000],
    attributes: { tokens: "500", [CONTEXTS]: '[{"document_id":"leak","content":"b"}]' },
  }),
  span({ tenant: B, trace: "t2", id: "s6", name: "llm", durations: [2000] }),
];

let container: StartedClickHouseContainer | undefined;
let admin: ClickHouseClient;
let reader: ClickHouseClient;

type Sendable = {
  sql: string;
  params: Readonly<Record<string, unknown>>;
  settings: Readonly<Record<string, unknown>>;
};

/** The rows a statement returns as the reader, as sorted `value|value` text. */
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

/** The built rows under A's setting, which its text predicate alone keeps under every tenant's. */
async function scopedRows({ built }: { built: Sendable }): Promise<string[]> {
  const rows = await rowsOf({ statement: built });
  expect(await rowsOf({ statement: built, tenants: EVERY_TENANT })).toEqual(rows);
  return rows;
}

describe("given analytics' and the trace filter's shapes sent as a reader on ClickHouse 26.8", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withName(`analytics-shapes-${process.pid}-ch`)
      .withResourcesQuota({ memory: 3 })
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
      `CREATE TABLE ${DATABASE}.trace_summaries (TenantId String, TraceId String,
         OccurredAt DateTime64(3), UpdatedAt DateTime64(3))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId)`,
      `CREATE TABLE ${DATABASE}.stored_spans (TenantId String, TraceId String, SpanId String,
         SpanName String, Durations Array(Float64), SpanAttributes Map(String, String),
         StartTime DateTime64(9), UpdatedAt DateTime64(3))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId, SpanId)`,
      `CREATE USER ${READER} IDENTIFIED WITH plaintext_password BY '${READER_PASSWORD}'`,
      `CREATE SETTINGS PROFILE ${READER}_profile SETTINGS ${TENANT_IDS_SETTING} = '' TO ${READER}`,
      `GRANT SELECT ON ${DATABASE}.* TO ${READER}`,
      `CREATE ROW POLICY ${READER}_summaries ON ${DATABASE}.trace_summaries USING ${POLICY} TO ${READER}`,
      `CREATE ROW POLICY ${READER}_spans ON ${DATABASE}.stored_spans USING ${POLICY} TO ${READER}`,
    ]) {
      await admin.command({ query });
    }
    await admin.insert({
      table: `${DATABASE}.trace_summaries`,
      values: SUMMARIES,
      format: "JSONEachRow",
    });
    await admin.insert({ table: `${DATABASE}.stored_spans`, values: SPANS, format: "JSONEachRow" });
    reader = createClient({ url, username: READER, password: READER_PASSWORD, database: DATABASE });
  }, 300_000);

  afterAll(async () => {
    await reader?.close();
    await admin?.close();
    await container?.stop();
  }, 60_000);

  describe("when a trace filter tests membership in a span read with within", () => {
    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("returns main's IN (SELECT …) rows, negated too", async () => {
      const llm = (negated: boolean) =>
        clickhouseRead({ scope: single })
          .from(summaries)
          .select({ TraceId: summaries.TraceId })
          .where(({ within, not }) => {
            const member = within(fn.tuple(summaries.TenantId, summaries.TraceId), (sub) =>
              sub
                .from(spans)
                .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
                .where(({ eq }) => eq(spans.SpanName, "llm")),
            );
            return negated ? not(member) : member;
          })
          .build();
      const kept = llm(false);
      expect(await scopedRows({ built: kept })).toEqual(["t1", "t3"]);
      const dropped = llm(true);
      expect(await scopedRows({ built: dropped })).toEqual(["t2", "t4"]);
    });

    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("keeps another tenant's keys out of the set where an unscoped subquery admits them", async () => {
      const built = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .where(({ within }) =>
          within(summaries.TraceId, (sub) =>
            sub
              .from(spans)
              .select({ TraceId: spans.TraceId })
              .where(({ eq }) => eq(spans.SpanName, "llm")),
          ),
        )
        .build();
      expect(await rowsOf({ statement: built, tenants: EVERY_TENANT })).toEqual(["t1", "t3"]);
    });
  });

  describe("when two metric reads are full-joined on their group key", () => {
    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("returns main's FULL OUTER JOIN rows, unmatched keys from both sides", async () => {
      const metric = (alias: string, name: string) =>
        clickhouseRead({ scope: single })
          .from(spans)
          .select({ TenantId: spans.TenantId, group_key: spans.TraceId, metric_value: fn.count() })
          .where(({ eq }) => eq(spans.SpanName, name))
          .groupBy(spans.TenantId, spans.TraceId)
          .as(alias);
      const left = metric("sq0", "llm");
      const right = metric("sq1", "tool");
      const built = clickhouseRead({ scope: single })
        .from(left)
        .fullJoin(right, ({ eq }) => eq(left.group_key, right.group_key))
        .select({
          left_key: left.group_key,
          right_key: right.group_key,
          llm: left.metric_value,
          tool: right.metric_value,
        })
        .build();
      expect(await scopedRows({ built })).toEqual(["t1||1|0", "t3|t3|1|1", "|t4|0|1"]);
    });
  });

  describe("when analytics' bucket, percentile, day-offset and token functions are built", () => {
    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("returns main's zoned buckets", async () => {
      const zone = "Asia/Kolkata";
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          SpanId: spans.SpanId,
          hours: fn.toStartOfInterval(spans.StartTime, { hours: 3 }, { timeZone: zone }),
          minutes: fn.toStartOfInterval(spans.StartTime, { minutes: 45 }, { timeZone: zone }),
          days: fn.toStartOfInterval(spans.StartTime, { days: 2 }, { timeZone: zone }),
          minute: fn.toStartOfMinute(spans.StartTime, { timeZone: zone }),
          day: fn.toStartOfDay(spans.StartTime, { timeZone: zone }),
          week: fn.toStartOfWeek(spans.StartTime, { mode: 1, timeZone: zone }),
          month: fn.toStartOfMonth(spans.StartTime, { timeZone: zone }),
        })
        .settings({ log_comment: "analytics:timeseries:stored_spans" })
        .build();
      const rows = await scopedRows({ built });
      // Main's rows: the 3-hour and 45-minute buckets fall on Kolkata's half hour, not UTC's.
      expect(rows).toEqual([
        "s1|2027-01-15 15:00:00|2027-01-15 16:00:00|2027-01-14 00:00:00|2027-01-15 16:00:00|2027-01-15 00:00:00|2027-01-11|2027-01-01",
        "s2|2027-01-16 21:00:00|2027-01-16 20:30:00|2027-01-16 00:00:00|2027-01-16 21:00:00|2027-01-16 00:00:00|2027-01-11|2027-01-01",
        "s3|2027-01-18 15:00:00|2027-01-18 16:00:00|2027-01-18 00:00:00|2027-01-18 16:00:00|2027-01-18 00:00:00|2027-01-18|2027-01-01",
        "s4|2027-01-15 12:00:00|2027-01-15 13:45:00|2027-01-14 00:00:00|2027-01-15 14:00:00|2027-01-15 00:00:00|2027-01-11|2027-01-01",
      ]);
    });

    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("returns main's percentiles, day offset and whole-number token sum", async () => {
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          p50: fn.quantileExact(0.5, fn.arrayElement(spans.Durations, 1)),
          p90: fn.quantileExactArray(0.9, spans.Durations),
          p99: fn.quantileTDigestArray(0.99, spans.Durations),
          tokens: fn.sum(fn.toUInt64OrZero(fn.mapGet(spans.SpanAttributes, "tokens"))),
        })
        .where(({ lt }) => lt(spans.StartTime, fn.addDays(param.epochMs(NOW), 2)))
        .build();
      expect(await scopedRows({ built })).toEqual(["5|40|40|12"]);
    });
  });

  describe("when a JSON array attribute is joined to its elements and their paths read", () => {
    /** @scenario "Analytics' and the trace filter's shapes return main's rows on 26.8" */
    it("returns main's ARRAY JOIN of Array(JSON) rows, a number id read as text", async () => {
      const context = fn.arrayJoin(
        fn.JSONExtract(fn.mapGet(spans.SpanAttributes, CONTEXTS), column.array(column.json())),
      );
      const built = clickhouseRead({ scope: single })
        .from(spans)
        .select({
          TraceId: spans.TraceId,
          document_id: fn.toString(fn.getSubcolumn(context, "document_id")),
          content: fn.toString(fn.getSubcolumn(context, "content")),
        })
        .build();
      expect(await scopedRows({ built })).toEqual(["t1|7|y", "t1|d1|x"]);
    });
  });
});
