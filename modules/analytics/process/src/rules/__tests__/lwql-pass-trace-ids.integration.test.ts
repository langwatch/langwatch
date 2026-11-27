/**
 * A pass read through the traces view's trace-ids twin returns exactly the rows the single read
 * of the statement as written returns, over traces with a second version and span-keyed pages.
 * @see specs/lwql/dedup-trace-ids.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { LangWatchQLPass } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../__tests__/migrated-clickhouse.harness.ts";
import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LangWatchQLPassRunService } from "../../services/langwatch-ql-pass-run.service.ts";
import { langWatchQLPassSql } from "../langwatch-ql-pass-sql.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const TRACES = 60;
const START = "2026-08-01 00:00:00";
const WINDOW = { from: "2026-08-01 10:00:00", to: "2026-08-03 00:00:00" };

type Row = Record<string, unknown>;

describe("given traces where some carry a newer version", () => {
  let ch: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    const migrated = await startMigratedClickHouse();
    ch = migrated.client;
    database = `${migrated.database}_pass_trace_ids`;
    const source = `${database}.trace_summaries`;

    await ch.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    await ch.command({ query: `CREATE DATABASE ${database}` });
    await ch.command({ query: `CREATE TABLE ${source} AS ${migrated.database}.trace_summaries` });
    await ch.command({ query: `SYSTEM STOP MERGES ${source}` });
    const traces = LWQL_VIEW_CATALOG.find((view) => view.name === "traces");
    if (!traces) throw new Error("the shipped catalogue has no traces view");
    const setup = LangWatchQLViewProvisioningService.create().setupStatements({
      names: {
        database,
        restrictedUser: "unused",
        settingsProfile: "unused",
        keyMapTable: "unused",
        tenantSetting: "custom_unused",
      },
      sourceDatabase: database,
      views: [traces],
      dedup: SHIPPED_LWQL_DEDUP,
    });
    for (const query of setup) await ch.command({ query });

    const insert = (select: string) =>
      ch.command({
        query:
          `INSERT INTO ${source} (TenantId, TraceId, Version, Attributes, OccurredAt, CreatedAt, UpdatedAt) ` +
          select,
      });
    const traceId = "concat('trace-', leftPad(toString(number), 3, '0'))";
    // One version of every trace, an hour apart.
    await insert(
      `SELECT 'tenant-pass', ${traceId}, '1', map('gen_ai.conversation.id', concat('v1-', toString(number))), ` +
        `toDateTime64('${START}', 3) + toIntervalHour(number), toDateTime64('${START}', 3), ` +
        `toDateTime64('${START}', 3) FROM numbers(${TRACES})`,
    );
    // A newer version of every third trace, with a new thread id; every sixth leaves the window.
    await insert(
      `SELECT 'tenant-pass', ${traceId}, '2', map('gen_ai.conversation.id', concat('v2-', toString(number))), ` +
        `if(number % 6 = 0, toDateTime64('2026-07-01 00:00:00', 3), toDateTime64('${START}', 3) + toIntervalHour(number)), ` +
        `toDateTime64('${START}', 3), toDateTime64('${START}', 3) + toIntervalDay(1) ` +
        `FROM numbers(${TRACES}) WHERE number % 3 = 0`,
    );
  }, 240_000);

  afterAll(async () => {
    await ch.command({ query: `DROP DATABASE IF EXISTS ${database}` });
  });

  async function read(query: { sql: string; parameters: Readonly<Record<string, unknown>> }) {
    const result = await ch.query({
      query: query.sql,
      query_params: { ...query.parameters },
      format: "JSONEachRow",
    });
    return result.json<Row>();
  }

  /** The pass as the service runs it, and every statement it sent. */
  async function runPass({ sql, pass }: { sql: string; pass: LangWatchQLPass }) {
    const sent: string[] = [];
    const result = await LangWatchQLPassRunService.create().run({
      sql,
      pass,
      database,
      views: LWQL_VIEW_CATALOG,
      query: async (composed) => {
        sent.push(composed.sql);
        return { rows: await read(composed) };
      },
    });
    return { rows: result.rows, sent };
  }

  const window = `OccurredAt >= '${WINDOW.from}' AND OccurredAt < '${WINDOW.to}'`;
  const byTrace = () =>
    `SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId, OccurredAt ` +
    `FROM ${database}.traces WHERE ${window}`;
  const bySpan = () =>
    `SELECT TraceId, arrayJoin(['s1', 's2', 's3']) AS SpanId, ` +
    `Attributes['gen_ai.conversation.id'] AS ThreadId FROM ${database}.traces WHERE ${window}`;

  const CASES: readonly (readonly [string, () => string, LangWatchQLPass])[] = [
    [
      "a sample",
      byTrace,
      { kind: "sample", keyColumns: ["ThreadId", "OccurredAt"], limit: 8, buckets: 2 },
    ],
    ["a first key page", byTrace, { kind: "keys", keyColumns: ["ThreadId"], limit: 7 }],
    [
      "a later key page",
      byTrace,
      {
        kind: "keys",
        keyColumns: ["ThreadId"],
        limit: 7,
        after: { traceId: "trace-020", spanId: null },
      },
    ],
    [
      "a later span-keyed page, whose traces repeat across rows",
      bySpan,
      {
        kind: "keys",
        keyColumns: ["SpanId", "ThreadId"],
        limit: 7,
        after: { traceId: "trace-015", spanId: "s2" },
      },
    ],
  ];

  describe("when a key or sample pass reads its keys over the twin", () => {
    /** @scenario "A two-step pass returns the rows the single read returns" */
    it.each(CASES)("returns the single read's rows for %s", async (_case, statement, pass) => {
      const sql = statement();

      const { rows, sent } = await runPass({ sql, pass });

      expect(sent).toHaveLength(2);
      expect(sent[1]).toContain("traces__ids(");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows).toEqual(await read(langWatchQLPassSql({ sql, pass })));
    });
  });

  describe("when a page pass hydrates traces with and without a newer version", () => {
    /** @scenario "A two-step pass returns the rows the single read returns" */
    it("returns the single read's rows, newest versions only", async () => {
      const sql = byTrace();
      const pass: LangWatchQLPass = {
        kind: "page",
        traceIds: ["trace-012", "trace-013", "trace-015", "trace-018", "trace-021"],
      };

      const { rows, sent } = await runPass({ sql, pass });

      expect(sent[0]).toContain("traces__ids(");
      expect(rows).toEqual(await read(langWatchQLPassSql({ sql, pass })));
      expect(rows.map((row) => row.ThreadId)).toEqual(["v1-13", "v2-15", "v2-21"]);
    });
  });
});
