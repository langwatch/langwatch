/** @vitest-environment node */

/**
 * Trace's remaining reads (fixtures/trace-gap-reads.ts) on a throwaway ClickHouse 26.8, sent as a
 * reader whose row policy reads the tenant setting: each returns the rows main's raw text returns,
 * with unmerged versions present, and another tenant's rows never appear.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidConditionExpression } from "../authorized-reads.ts";
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
} from "./fixtures/trace-gap-reads.ts";

const DATABASE = `trace_gaps_${process.pid}`;
const BARE = `trace_gaps_bare_${process.pid}`;
const READER = `trace_gaps_reader_${process.pid}`;
const READER_PASSWORD = "trace-gaps-reader-test-login";
const A = "proj_a";
const B = "proj_b";
const C = "proj_c";
const NOW = Date.now();
const DAY = 86_400_000;
const POLICY =
  "has(arrayFilter(tenant -> notEmpty(tenant), " +
  `splitByChar(',', getSetting('${TENANT_IDS_SETTING}'))), TenantId)`;
const CONVERSATION = "Attributes['gen_ai.conversation.id']";

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
const millis = (param: string) => `fromUnixTimestamp64Milli({${param}:Int64})`;

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
  params = statement.params,
  database = DATABASE,
  ordered = false,
}: {
  statement: Sendable;
  params?: Readonly<Record<string, unknown>>;
  database?: string;
  ordered?: boolean;
}): Promise<string[]> {
  const result = await readers[database]!.query({
    query: statement.sql,
    query_params: { ...params },
    clickhouse_settings: statement.settings as Record<string, string | number>,
    format: "JSONEachRow",
  });
  const rows = (await result.json<Record<string, unknown>>()).map((row) =>
    Object.values(row).map(String).join("|"),
  );
  return ordered ? rows : rows.toSorted();
}

/** Main's text sent with the built statement's settings, so the same row policy applies. */
const mainOf = ({ built, sql }: { built: Sendable; sql: string }): Sendable => ({
  sql,
  params: {},
  settings: built.settings,
});

const dedupOf = (where: string) =>
  `(TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries
     WHERE ${where} GROUP BY TenantId, TraceId)`;
const TENANTS = "TenantId IN {tenants:Array(String)}";

const set: ReaderScope = tenantScope.set({ tenantIds: [A, B] });
const single: ReaderScope = tenantScope.single({ tenantId: A });

describe("given trace's remaining reads sent as a reader under a row policy on ClickHouse 26.8", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withName(`rp-b10-${process.pid}-ch`)
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
    it("returns main's count, on latest versions and tenants A and B only", async () => {
      const built = sessionCountRead({ scope: set });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT uniqExact(TenantId, ${CONVERSATION}) AS totalHits FROM trace_summaries
            WHERE ${TENANTS} AND ${CONVERSATION} != '' AND ${dedupOf(TENANTS)}`,
        }),
        params: { tenants: [A, B] },
      });

      // A: c2, c1, c3, c5; B: c1, c6.
      expect(main).toEqual(["6"]);
      expect(await rowsOf({ statement: built })).toEqual(main);
    });
  });

  describe("when session-groups' page is built with a keyset over aggregates in HAVING", () => {
    const mainPage = (having: string) => `
      SELECT TenantId, ${CONVERSATION} AS ConversationId, count() AS TraceCount,
        sum(TotalCost) AS SessionCost
      FROM trace_summaries
      WHERE ${TENANTS} AND ${CONVERSATION} != '' AND ${dedupOf(TENANTS)}
      GROUP BY TenantId, ConversationId
      ${having}
      ORDER BY sum(TotalCost) DESC, ConversationId ASC, TenantId ASC
      LIMIT 2`;
    const HAVING = `HAVING (sum(TotalCost) < {cursorSortValue:Float64} OR (sum(TotalCost) =
      {cursorSortValue:Float64} AND (ConversationId, TenantId) > ({cursorConversationId:String},
      {cursorTenantId:String})))`;

    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns main's pages in main's order, the second after a tie on the sort value", async () => {
      const first = sessionPageRead({ scope: set, cursor: undefined, limit: 2 });
      const mainFirst = await rowsOf({
        statement: mainOf({ built: first, sql: mainPage("") }),
        params: { tenants: [A, B] },
        ordered: true,
      });
      expect(mainFirst).toEqual(["proj_b|c1|1|5", "proj_a|c2|1|3"]);
      expect(await rowsOf({ statement: first, ordered: true })).toEqual(mainFirst);

      const cursor = { sortValue: 2, conversationId: "c1", tenantId: A };
      const second = sessionPageRead({ scope: set, cursor, limit: 2 });
      const mainSecond = await rowsOf({
        statement: mainOf({ built: second, sql: mainPage(HAVING) }),
        params: {
          tenants: [A, B],
          cursorSortValue: 2,
          cursorConversationId: "c1",
          cursorTenantId: A,
        },
        ordered: true,
      });
      expect(mainSecond).toEqual(["proj_a|c3|1|2", "proj_b|c6|1|2"]);
      expect(await rowsOf({ statement: second, ordered: true })).toEqual(mainSecond);
    });
  });

  describe("when session-groups' membership is built as a tuple looked up in two CTEs", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns main's traces of the IN (… UNION DISTINCT …) read", async () => {
      const built = sessionMembersRead({ scope: set, minCost: 3, term: "hello" });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT TraceId FROM trace_summaries
            WHERE ${TENANTS} AND ${CONVERSATION} != '' AND ${dedupOf(TENANTS)}
              AND (TenantId, ${CONVERSATION}) IN (
                SELECT DISTINCT TenantId, ${CONVERSATION} AS SessionId FROM trace_summaries
                WHERE ${TENANTS} AND ${CONVERSATION} != '' AND ${dedupOf(TENANTS)}
                  AND (TotalCost >= {minCost:Float64})
                UNION DISTINCT
                SELECT DISTINCT TenantId, ProviderSessionId AS SessionId FROM log_records
                WHERE ${TENANTS} AND ProviderSessionId != ''
                  AND (positionCaseInsensitive(ifNull(BodyText, ''), {term:String}) > 0))`,
        }),
        params: { tenants: [A, B], minCost: 3, term: "hello" },
      });

      // A: t1 (c2, cost 3), t5 (c5's log); B: t1 (c1, cost 5), t6 (c6's log). Never C's t7.
      expect(main).toEqual(["t1", "t1", "t5", "t6"]);
      expect(await rowsOf({ statement: built })).toEqual(main);
    });
  });

  describe("when instant-eval's run dating elects on a tuple version with LIMIT 1 BY", () => {
    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns main's one row per run, the tie broken as main's tuple breaks it", async () => {
      const built = instantEvalRunsRead({ scope: single, runIds: ["r1", "r2", "r1"] });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT t.RunId AS RunId, toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
              toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt
            FROM instant_eval_runs AS t
            WHERE t.TenantId = {tenantId:String} AND t.RunId IN ({runIds:Array(String)})
              AND (t.TenantId, t.RunId, (t.WrittenAt, ifNull(t.AcceptedAt, toDateTime64(0, 3)), t.LastEventId)) IN (
                SELECT TenantId, RunId, max((WrittenAt, ifNull(AcceptedAt, toDateTime64(0, 3)), LastEventId))
                FROM instant_eval_runs
                WHERE TenantId = {tenantId:String} AND RunId IN ({runIds:Array(String)})
                GROUP BY TenantId, RunId)
            LIMIT 1 BY t.RunId`,
        }),
        params: { tenantId: A, runIds: ["r1", "r2"] },
      });

      expect(main).toEqual([`r1|${NOW - 20}|null`, `r2|${NOW - 40}|null`]);
      expect(await rowsOf({ statement: built })).toEqual(main);
    });
  });

  describe("when evaluation-runs' attempts are read from targets with and without the columns", () => {
    const mainRuns = (attempts: string) => `
      SELECT EvaluationId, ${attempts}, toUnixTimestamp64Milli(LastAttemptAt) AS LastAttemptAtMs
      FROM evaluation_runs AS r
      WHERE r.TenantId = {tenantId:String}
        AND r.ScheduledAt >= now() - INTERVAL 7 DAY
        AND r.TraceId = {traceId:String}
        AND (r.TenantId, r.EvaluationId, r.UpdatedAt) IN (
          SELECT TenantId, EvaluationId, max(UpdatedAt) FROM evaluation_runs
          WHERE TenantId = {tenantId:String} AND ScheduledAt >= now() - INTERVAL 7 DAY
            AND TraceId = {traceId:String}
          GROUP BY TenantId, EvaluationId)
      ORDER BY r.UpdatedAt DESC`;
    const ATTEMPTS = {
      Attempts: "toUInt16(0)",
      LastAttemptAt: "CAST(NULL AS Nullable(DateTime64(3)))",
    } as const;

    /** @scenario "Trace's remaining reads return main's rows on 26.8" */
    it("returns main's rows from each target, absent columns as their defaults", async () => {
      const expected: Record<string, string[]> = {
        [DATABASE]: [`ev1|2|${at(NOW - 100)}|${NOW - 100}`, "ev2|0|null|null"],
        [BARE]: ["ev1|0|null|null", "ev2|0|null|null"],
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
        const attempts = await columns.select({
          table: "evaluation_runs",
          alias: "r",
          columns: ATTEMPTS,
        });
        const main = await rowsOf({
          statement: mainOf({ built, sql: mainRuns(attempts) }),
          params: { tenantId: A, traceId: "tr" },
          database,
          ordered: true,
        });

        expect(main).toEqual(expected[database]);
        // Main also selects the raw LastAttemptAt beside its epoch ms; the port reads only the ms.
        const withoutRawMoment = main.map((row) => row.split("|").toSpliced(2, 1).join("|"));
        expect(await rowsOf({ statement: built, database, ordered: true })).toEqual(
          withoutRawMoment,
        );
      }
    });
  });

  describe("when trace braid's owner activity is built with braid conditions inside argMax", () => {
    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("returns main's per-braid span counts of latest versions", async () => {
      const braids = [braidOf(1000), braidOf(5000)] as const;
      const built = braidActivityRead({ scope: single, braids, sinceMs: NOW - 10_000 });
      const params: Record<string, unknown> = { tenantId: A, sinceMs: NOW - 10_000 };
      const windowed = braids.map((braid, index) => {
        const name = `a${index}`;
        const condition = braidConditionExpression({ ...braid, prefix: name });
        Object.assign(params, condition.params, {
          [`${name}_fromMs`]: braid.fromMs,
          [`${name}_untilMs`]: braid.untilMs,
        });
        const window = `StartTime >= ${millis(`${name}_fromMs`)} AND StartTime < ${millis(`${name}_untilMs`)}`;
        return `argMax((${window} AND ${condition.sql}), UpdatedAt) AS ${name}`;
      });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT sum(a0) AS a0, sum(a1) AS a1 FROM (
            SELECT ${windowed.join(", ")} FROM stored_spans
            WHERE TenantId = {tenantId:String} AND StartTime >= ${millis("sinceMs")}
            GROUP BY TraceId, SpanId)`,
        }),
        params,
      });

      // s2 in both; s3 only in the wide braid; s1's latest version is not web; B's s9 never.
      expect(main).toEqual(["1|2"]);
      expect(await rowsOf({ statement: built })).toEqual(main);
    });

    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("returns main's marked spans of a trace", async () => {
      const braid = braidOf(1000);
      const built = braidMarkedRead({ scope: single, braid, traceId: "t1" });
      const condition = braidConditionExpression({ ...braid, prefix: "braid0" });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT SpanId, ${condition.sql} AS Braided FROM stored_spans
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
              AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
                SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans
                WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
                GROUP BY TenantId, TraceId, SpanId)`,
        }),
        params: { tenantId: A, traceId: "t1", ...condition.params },
      });

      expect(main).toEqual(["s1|0", "s2|1"]);
      expect(await rowsOf({ statement: built })).toEqual(main);
    });
  });

  describe("when trace braid's attribute keys are built with arrayJoin in a derived read", () => {
    /** @scenario "Trace braid's reads return main's rows on 26.8" */
    it("returns main's ARRAY JOIN key counts in main's order", async () => {
      const input = { sinceMs: NOW - 10_000, excludedPrefix: "langwatch.", limit: 10 };
      const built = attributeKeysRead({ scope: single, sampleRows: 50_000, ...input });
      const main = await rowsOf({
        statement: mainOf({
          built,
          sql: `SELECT key, count() AS spanCount FROM (
              SELECT SpanAttributes FROM stored_spans
              WHERE TenantId = {tenantId:String} AND StartTime >= ${millis("sinceMs")}
              LIMIT {sampleRows:UInt32})
            ARRAY JOIN mapKeys(SpanAttributes) AS key
            WHERE NOT startsWith(key, {excludedPrefix:String})
            GROUP BY key ORDER BY spanCount DESC, key ASC LIMIT {limit:UInt32}`,
        }),
        params: { tenantId: A, sampleRows: 50_000, ...input },
        ordered: true,
      });

      // Every version is sampled, as main samples them: s1's two versions count twice.
      expect(main).toEqual(["orchestrator|4", "model|2", "region|1"]);
      expect(await rowsOf({ statement: built, ordered: true })).toEqual(main);
    });
  });
});
