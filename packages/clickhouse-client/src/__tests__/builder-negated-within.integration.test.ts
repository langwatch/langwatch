/** @vitest-environment node */

/**
 * A negated set subquery on a throwaway ClickHouse 26.8, sent as a reader whose row policy reads
 * the tenant setting: `NOT IN (SELECT …)` keeps the inner tenant predicate, so another tenant's
 * spans never decide a match, and under a proof a span outside the share's window does not either.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { sealAuthorization } from "@langwatch/authorization";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { column } from "../builder/expression.ts";
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

const DATABASE = `negated_within_${process.pid}`;
const READER = `negated_within_reader_${process.pid}`;
const READER_PASSWORD = "negated-within-reader-test-login";
const A = "proj_a";
const B = "proj_b";
const EVERY_TENANT = [A, B].join(",");
const NOW = 1_800_009_000_000;
const HOUR = 3_600_000;
const POLICY =
  "has(arrayFilter(tenant -> notEmpty(tenant), " +
  `splitByChar(',', getSetting('${TENANT_IDS_SETTING}'))), TenantId)`;

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
  },
});

const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
  },
});

const SUMMARIES = [A, B].flatMap((TenantId) =>
  ["t1", "t2", "t3", "t4"].map((TraceId) => ({ TenantId, TraceId, OccurredAt: at(NOW) })),
);

/** A's llm spans on t1 and t3; B's on t1 and t4, and on t2 two hours before the share opens. */
const SPANS = [
  { TenantId: A, TraceId: "t1", SpanId: "s1", SpanName: "llm", StartTime: at(NOW) },
  { TenantId: A, TraceId: "t3", SpanId: "s2", SpanName: "llm", StartTime: at(NOW) },
  { TenantId: B, TraceId: "t1", SpanId: "s3", SpanName: "llm", StartTime: at(NOW) },
  { TenantId: B, TraceId: "t2", SpanId: "s4", SpanName: "llm", StartTime: at(NOW - 2 * HOUR) },
  { TenantId: B, TraceId: "t4", SpanId: "s5", SpanName: "llm", StartTime: at(NOW) },
];

const proof = () =>
  tenantScope.fromProof({
    authorization: sealAuthorization({
      actor: { type: "user", id: "ana" },
      principal: { type: "user", id: "ana" },
      scope: { organizationId: "org_acme" },
      grants: [
        { projectId: A, permissions: ["traces:view"], via: [], kind: "own" },
        {
          projectId: B,
          permissions: ["traces:view"],
          via: ["grant_member"],
          kind: "shared",
          condition: { type: "trace", from: NOW - 1000, until: null },
        },
      ],
      expiresAt: NOW + 30_000,
      purpose: { kind: "route", route: "traces.get" },
    }),
    reads: "traces",
    now: () => NOW,
  });

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

describe("given a negated set subquery sent as a reader on ClickHouse 26.8", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withName(`rp-b13-${process.pid}-ch`)
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
         OccurredAt DateTime64(3)) ENGINE = MergeTree ORDER BY (TenantId, TraceId)`,
      `CREATE TABLE ${DATABASE}.stored_spans (TenantId String, TraceId String, SpanId String,
         SpanName String, StartTime DateTime64(9))
         ENGINE = MergeTree ORDER BY (TenantId, TraceId, SpanId)`,
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

  describe("when the read is single-tenant and tests the trace id alone", () => {
    /** @scenario "A negated set subquery keeps tenancy on 26.8" */
    it("returns the tenant's traces without its own llm span, whatever the setting", async () => {
      const built = clickhouseRead({ scope: tenantScope.single({ tenantId: A }) })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .where(({ within }) =>
          within(
            summaries.TraceId,
            (sub) =>
              sub
                .from(spans)
                .select({ TraceId: spans.TraceId })
                .where(({ eq }) => eq(spans.SpanName, "llm")),
            { negated: true },
          ),
        )
        .build();
      const unscoped: Sendable = {
        sql:
          "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND " +
          "TraceId NOT IN (SELECT TraceId FROM stored_spans WHERE SpanName = 'llm')",
        params: { tenantId: A },
        settings: built.settings,
      };

      expect(built.sql).toContain(" NOT IN (SELECT TraceId FROM stored_spans WHERE TenantId = ");
      expect(await rowsOf({ statement: built })).toEqual(["t2", "t4"]);
      expect(await rowsOf({ statement: built, tenants: EVERY_TENANT })).toEqual(["t2", "t4"]);
      // The probe has teeth: without the inner predicate, B's spans on t2 and t4 decide A's rows.
      expect(await rowsOf({ statement: unscoped, tenants: EVERY_TENANT })).toEqual([]);
    });
  });

  describe("when the read is proof-scoped with a share window", () => {
    /** @scenario "A negated set subquery keeps tenancy on 26.8" */
    it("holds each tenant to its own spans, the share's only within its window", async () => {
      const built = clickhouseRead({ scope: proof() })
        .from(summaries)
        .withinWindows()
        .select({ TenantId: summaries.TenantId, TraceId: summaries.TraceId })
        .where(({ within }) =>
          within(
            fn.tuple(summaries.TenantId, summaries.TraceId),
            (sub) =>
              sub
                .from(spans)
                .withinWindows()
                .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
                .where(({ eq }) => eq(spans.SpanName, "llm")),
            { negated: true },
          ),
        )
        .build();

      expect(built.settings[TENANT_IDS_SETTING]).toBe(EVERY_TENANT);
      expect(await rowsOf({ statement: built })).toEqual([
        `${A}|t2`,
        `${A}|t4`,
        `${B}|t2`,
        `${B}|t3`,
      ]);
    });
  });
});
