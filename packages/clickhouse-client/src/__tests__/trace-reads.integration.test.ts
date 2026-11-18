/** @vitest-environment node */

/**
 * Trace's built reads (fixtures/trace-reads.ts) on a throwaway ClickHouse 26.8, sent as a reader
 * whose row policy reads the tenant setting: each returns the literal rows main's raw reads
 * returned, with unmerged versions present, and another tenant's rows never appear.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ReaderScope, tenantScope } from "../builder/scope.ts";
import {
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  testClickHouseProfilePins,
} from "../clickhouse-test-endpoints.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";
import { CLICKHOUSE_COLUMNS_QUERY, ClickHouseColumns } from "../present-columns.ts";
import {
  attributeKeysRead,
  braidActivityRead,
  braidMarkedRead,
  evaluationAttemptsRead,
  instantEvalRunsRead,
  sessionCountRead,
  sessionMembersRead,
  sessionPageRead,
} from "./fixtures/trace-reads.ts";

const DATABASE = `trace_reads_${process.pid}`;
const BARE = `trace_reads_bare_${process.pid}`;
const READER = `trace_reads_reader_${process.pid}`;
const READER_PASSWORD = "trace-reads-reader-test-login";
const A = "proj_a";
const B = "proj_b";
const C = "proj_c";
const NOW = Date.now();
const DAY = 86_400_000;
const POLICY =
  "has(arrayFilter(tenant -> notEmpty(tenant), " +
  `splitByChar(',', getSetting('${TENANT_IDS_SETTING}'))), TenantId)`;

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

const summary = (
  TenantId: string,
  TraceId: string,
  conversation: string,
  TotalCost: number,
  updatedAgo: number,
) => ({
  TenantId,
  TraceId,
  OccurredAt: at(NOW - 1000),
  UpdatedAt: at(NOW - updatedAgo),
  TotalCost,
  Attributes: conversation === "" ? {} : { "gen_ai.conversation.id": conversation },
});

/** t1's latest version moved it from c1 to c2; t4's dropped its conversation. */
const SUMMARIES = [
  summary(A, "t1", "c1", 1, 300),
  summary(A, "t1", "c2", 3, 100),
  summary(A, "t2", "c1", 2, 100),
  summary(A, "t3", "c3", 2, 100),
  summary(A, "t4", "c4", 9, 300),
  summary(A, "t4", "", 9, 100),
  summary(A, "t5", "c5", 0.5, 100),
  summary(B, "t1", "c1", 5, 100),
  summary(B, "t6", "c6", 2, 100),
  summary(C, "t7", "c7", 7, 100),
];

const LOGS = [
  { TenantId: A, TimeUnixMs: at(NOW), ProviderSessionId: "c5", BodyText: "Hello there" },
  { TenantId: A, TimeUnixMs: at(NOW), ProviderSessionId: "c3", BodyText: null },
  { TenantId: B, TimeUnixMs: at(NOW), ProviderSessionId: "c6", BodyText: "say HELLO" },
  { TenantId: C, TimeUnixMs: at(NOW), ProviderSessionId: "c7", BodyText: "hello" },
];

const run = (
  TenantId: string,
  RunId: string,
  writtenAgo: number,
  acceptedAgo: number | null,
  LastEventId: string,
  createdAgo: number,
) => ({
  TenantId,
  RunId,
  CreatedAt: at(NOW - createdAgo),
  FinishedAt: null,
  WrittenAt: at(NOW - writtenAgo),
  AcceptedAt: acceptedAgo === null ? null : at(NOW - acceptedAgo),
  LastEventId,
});

/** r1 ties on WrittenAt and is decided by AcceptedAt; r2 by LastEventId, with a NULL AcceptedAt. */
const RUNS = [
  run(A, "r1", 100, null, "e1", 10),
  run(A, "r1", 100, 50, "e0", 20),
  run(A, "r2", 100, null, "e1", 30),
  run(A, "r2", 100, null, "e2", 40),
  run(A, "r2", 100, null, "e2", 40),
  run(A, "r3", 100, null, "e1", 50),
  run(B, "r1", 10, 10, "e9", 60),
];

const evaluation = (
  TenantId: string,
  EvaluationId: string,
  scheduledAgo: number,
  updatedAgo: number,
  Attempts: number,
) => ({
  TenantId,
  EvaluationId,
  TraceId: "tr",
  ScheduledAt: at(NOW - scheduledAgo),
  UpdatedAt: at(NOW - updatedAgo),
  Attempts,
  LastAttemptAt: Attempts === 0 ? null : at(NOW - updatedAgo),
});

/** ev3 is outside the 7-day window; ev1's later version wins. */
const EVALUATIONS = [
  evaluation(A, "ev1", DAY, 300, 1),
  evaluation(A, "ev1", DAY, 100, 2),
  evaluation(A, "ev2", 2 * DAY, 200, 0),
  evaluation(A, "ev3", 10 * DAY, 100, 4),
  evaluation(B, "ev4", DAY, 100, 1),
];

const span = (
  TenantId: string,
  TraceId: string,
  SpanId: string,
  startAgo: number,
  updatedAgo: number,
  SpanAttributes: Record<string, string>,
) => ({
  TenantId,
  TraceId,
  SpanId,
  SpanName: "llm",
  StartTime: at(NOW - startAgo),
  UpdatedAt: at(NOW - updatedAgo),
  SpanAttributes,
  ResourceAttributes: {},
});

/** s1's latest version left the web orchestrator; s3 started before the narrow braid's window. */
const SPANS = [
  span(A, "t1", "s1", 100, 300, { orchestrator: "web", "langwatch.x": "1" }),
  span(A, "t1", "s1", 100, 100, { orchestrator: "api", "langwatch.x": "1" }),
  span(A, "t1", "s2", 200, 100, { orchestrator: "web", model: "m" }),
  span(A, "t2", "s3", 2000, 100, { orchestrator: "web", model: "m", region: "eu" }),
  span(B, "t1", "s9", 100, 100, { orchestrator: "web", other: "b" }),
];
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const braidOf = (fromAgo: number) => ({
  compiledWhere: WEB,
  reader: "proj_reader",
  fromMs: NOW - fromAgo,
  untilMs: NOW,
});

let container: StartedClickHouseContainer | undefined;
let admin: ClickHouseClient;
const readers: Record<string, ClickHouseClient> = {};

type Sendable = {
  sql: string;
  params: Readonly<Record<string, unknown>>;
  settings: Readonly<Record<string, unknown>>;
};

/** The rows a statement returns as the reader, as `value|value` text, sorted unless ordered. */
async function rowsOf({
  statement,
  database = DATABASE,
  ordered = false,
}: {
  statement: Sendable;
  database?: string;
  ordered?: boolean;
}): Promise<string[]> {
  const result = await readers[database]!.query({
    query: statement.sql,
    query_params: { ...statement.params },
    clickhouse_settings: statement.settings as Record<string, string | number>,
    format: "JSONEachRow",
  });
  const rows = (await result.json<Record<string, unknown>>()).map((row) =>
    Object.values(row).map(String).join("|"),
  );
  return ordered ? rows : rows.toSorted();
}

const set: ReaderScope = tenantScope.set({ tenantIds: [A, B] });
const single: ReaderScope = tenantScope.single({ tenantId: A });

describe("given trace's built reads sent as a reader under a row policy on ClickHouse 26.8", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withName(`trace-reads-${process.pid}-ch`)
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
    const evaluationsDdl = (database: string, attempts: string) =>
      `CREATE TABLE ${database}.evaluation_runs (TenantId String, EvaluationId String,
         TraceId String, ScheduledAt DateTime64(3), UpdatedAt DateTime64(3)${attempts})
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, EvaluationId)`;
    const tables = [
      "trace_summaries",
      "log_records",
      "instant_eval_runs",
      "evaluation_runs",
      "stored_spans",
    ];
    for (const query of [
      `CREATE DATABASE IF NOT EXISTS ${DATABASE}`,
      `CREATE DATABASE IF NOT EXISTS ${BARE}`,
      `CREATE TABLE ${DATABASE}.trace_summaries (TenantId String, TraceId String,
         OccurredAt DateTime64(3), UpdatedAt DateTime64(3), TotalCost Float64,
         Attributes Map(String, String))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId)`,
      `CREATE TABLE ${DATABASE}.log_records (TenantId String, TimeUnixMs DateTime64(3),
         ProviderSessionId String, BodyText Nullable(String))
         ENGINE = MergeTree ORDER BY (TenantId, TimeUnixMs)`,
      `CREATE TABLE ${DATABASE}.instant_eval_runs (TenantId String, RunId String,
         CreatedAt DateTime64(3), FinishedAt Nullable(DateTime64(3)), WrittenAt DateTime64(3),
         AcceptedAt Nullable(DateTime64(3)), LastEventId String)
         ENGINE = ReplacingMergeTree(WrittenAt) ORDER BY (TenantId, RunId)`,
      evaluationsDdl(
        DATABASE,
        ", Attempts UInt16, LastAttemptAt Nullable(DateTime64(3)), NextAttemptAt Nullable(DateTime64(3))",
      ),
      evaluationsDdl(BARE, ""),
      `CREATE TABLE ${DATABASE}.stored_spans (TenantId String, TraceId String, SpanId String,
         SpanName String, StartTime DateTime64(9), UpdatedAt DateTime64(3),
         SpanAttributes Map(String, String), ResourceAttributes Map(String, String))
         ENGINE = ReplacingMergeTree(UpdatedAt) ORDER BY (TenantId, TraceId, SpanId)`,
      `CREATE USER ${READER} IDENTIFIED WITH plaintext_password BY '${READER_PASSWORD}'`,
      `CREATE SETTINGS PROFILE ${READER}_profile SETTINGS ${TENANT_IDS_SETTING} = '' TO ${READER}`,
      `GRANT SELECT ON ${DATABASE}.* TO ${READER}`,
      `GRANT SELECT ON ${BARE}.* TO ${READER}`,
      ...tables.map(
        (table) =>
          `CREATE ROW POLICY ${READER}_${table} ON ${DATABASE}.${table} USING ${POLICY} TO ${READER}`,
      ),
      `CREATE ROW POLICY ${READER}_bare ON ${BARE}.evaluation_runs USING ${POLICY} TO ${READER}`,
      ...tables.map((table) => `SYSTEM STOP MERGES ${DATABASE}.${table}`),
      `SYSTEM STOP MERGES ${BARE}.evaluation_runs`,
    ]) {
      await admin.command({ query });
    }
    const keepVersions = { optimize_on_insert: 0 } as const;
    for (const [table, values] of [
      [`${DATABASE}.trace_summaries`, SUMMARIES],
      [`${DATABASE}.log_records`, LOGS],
      [`${DATABASE}.instant_eval_runs`, RUNS],
      [`${DATABASE}.evaluation_runs`, EVALUATIONS],
      [`${DATABASE}.stored_spans`, SPANS],
      [
        `${BARE}.evaluation_runs`,
        EVALUATIONS.map(({ Attempts: _a, LastAttemptAt: _l, ...rest }) => rest),
      ],
    ] as const) {
      await admin.insert({
        table,
        values: [...values],
        format: "JSONEachRow",
        clickhouse_settings: keepVersions,
      });
    }
    for (const database of [DATABASE, BARE]) {
      readers[database] = createClient({
        url,
        username: READER,
        password: READER_PASSWORD,
        database,
      });
    }
  }, 300_000);

  afterAll(async () => {
    for (const reader of Object.values(readers)) await reader.close();
    await admin?.close();
    await container?.stop();
  }, 60_000);

  describe("when session-groups' count is built with a two-argument uniqExact", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("counts sessions of latest versions, tenants A and B only", async () => {
      // A: c2, c1, c3, c5; B: c1, c6.
      expect(await rowsOf({ statement: sessionCountRead({ scope: set }) })).toEqual(["6"]);
    });
  });

  describe("when session-groups' page is built with a keyset over aggregates in HAVING", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns pages by cost, the second after a tie on the sort value", async () => {
      const first = sessionPageRead({ scope: set, cursor: undefined, limit: 2 });
      expect(await rowsOf({ statement: first, ordered: true })).toEqual([
        "proj_b|c1|1|5",
        "proj_a|c2|1|3",
      ]);

      const cursor = { sortValue: 2, conversationId: "c1", tenantId: A };
      const second = sessionPageRead({ scope: set, cursor, limit: 2 });
      expect(await rowsOf({ statement: second, ordered: true })).toEqual([
        "proj_a|c3|1|2",
        "proj_b|c6|1|2",
      ]);
    });
  });

  describe("when session-groups' membership is built as a tuple looked up in two CTEs", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns the traces of sessions matching either the cost or the log term", async () => {
      const built = sessionMembersRead({ scope: set, minCost: 3, term: "hello" });

      // A: t1 (c2, cost 3), t5 (c5's log); B: t1 (c1, cost 5), t6 (c6's log). Never C's t7.
      expect(await rowsOf({ statement: built })).toEqual(["t1", "t1", "t5", "t6"]);
    });
  });

  describe("when instant-eval's run dating elects on a tuple version with LIMIT 1 BY", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns one row per run, a WrittenAt tie broken by AcceptedAt then LastEventId", async () => {
      const built = instantEvalRunsRead({ scope: single, runIds: ["r1", "r2", "r1"] });

      expect(await rowsOf({ statement: built })).toEqual([
        `r1|${NOW - 20}|null`,
        `r2|${NOW - 40}|null`,
      ]);
    });
  });

  describe("when evaluation-runs' attempts are read from targets with and without the columns", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns each target's rows, absent columns as their defaults", async () => {
      const expected: Record<string, string[]> = {
        [DATABASE]: [`ev1|2|${NOW - 100}`, "ev2|0|null"],
        [BARE]: ["ev1|0|null", "ev2|0|null"],
      };
      for (const database of [DATABASE, BARE]) {
        const columns = ClickHouseColumns.over({
          read: async () => {
            const result = await readers[database]!.query({
              query: CLICKHOUSE_COLUMNS_QUERY,
              format: "JSONEachRow",
            });
            return result.json<{ table: string; name: string }>();
          },
        });
        const holds = await columns.holds({ table: "evaluation_runs" });
        const built = evaluationAttemptsRead({ scope: single, traceId: "tr", holds });

        expect(await rowsOf({ statement: built, database, ordered: true })).toEqual(
          expected[database],
        );
      }
    });
  });

  describe("when trace braid's owner activity is built with braid conditions inside argMax", () => {
    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("returns per-braid span counts of latest versions", async () => {
      const braids = [braidOf(1000), braidOf(5000)] as const;
      const built = braidActivityRead({ scope: single, braids, sinceMs: NOW - 10_000 });

      // s2 in both; s3 only in the wide braid; s1's latest version is not web; B's s9 never.
      expect(await rowsOf({ statement: built })).toEqual(["1|2"]);
    });

    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("marks the spans of a trace that match the braid, on latest versions", async () => {
      const built = braidMarkedRead({ scope: single, braid: braidOf(1000), traceId: "t1" });

      expect(await rowsOf({ statement: built })).toEqual(["s1|0", "s2|1"]);
    });
  });

  describe("when trace braid's attribute keys are built with arrayJoin in a derived read", () => {
    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("returns key counts over the sample, by count then key", async () => {
      const input = { sinceMs: NOW - 10_000, excludedPrefix: "langwatch.", limit: 10 };
      const built = attributeKeysRead({ scope: single, sampleRows: 50_000, ...input });

      // Every version is sampled: s1's two versions count twice.
      expect(await rowsOf({ statement: built, ordered: true })).toEqual([
        "orchestrator|4",
        "model|2",
        "region|1",
      ]);
    });
  });
});
