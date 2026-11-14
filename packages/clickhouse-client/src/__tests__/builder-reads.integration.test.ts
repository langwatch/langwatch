/** @vitest-environment node */

/**
 * The typed builder's statements on a throwaway ClickHouse 26.8 (ADR-202), sent as a reader whose
 * row policy reads the tenant setting: each shape returns its tenant's rows, its text predicate
 * holds alone under a widened setting, and another tenant's rows never appear.
 * @see specs/clickhouse/typed-query-builder.feature
 */
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

import { column, param } from "../builder/expression.ts";
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
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";

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
