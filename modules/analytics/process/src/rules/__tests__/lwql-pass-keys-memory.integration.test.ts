/**
 * The Instant Evals key and sample passes over the shipped traces view, under a memory cap.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { LangWatchQLPass } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../__tests__/migrated-clickhouse.harness.ts";
import { LangWatchQLAppFunctionStatementsService } from "../../features/provisioning/services/langwatch-ql-app-function-statements.service.ts";
import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LangWatchQLPassRunService } from "../../services/langwatch-ql-pass-run.service.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const PARTS = 3;
/** Past one read block, so the view's in-order merge holds a full block of every part. */
const ROWS_PER_PART = 66_000;
/** Rows per insert block, so seeding never holds a large block on a shared server. */
const INSERT_BLOCK_ROWS = "2000";
const ATTRIBUTE_KEYS = 25;
/**
 * The passes peak at up to 75 MiB (ADR-006, `max_threads = 4`) and the single read at 700 to 800
 * MiB: 200 MB leaves the passes about 2.5x headroom and still refuses the single read.
 */
const MEMORY_CAP_BYTES = "200000000";
const SAMPLE_BUCKETS = 3;
const START = "2026-08-01 00:00:00";
/** A 14-day window inside the 60 days the traces span. */
const WINDOW = { from: "2026-09-10 00:00:00", to: "2026-09-24 00:00:00" };
const MEMORY_LIMIT_EXCEEDED = "241";

const CAPPED = { max_memory_usage: MEMORY_CAP_BYTES, max_threads: 4, max_block_size: "65505" };

interface KeyRow {
  TraceId: string;
  ThreadId: string;
  OccurredAt: string;
}

describe("given an Instant Evals statement over a busy project's traces", () => {
  let ch: ClickHouseClient;
  let database: string;
  let statement: string;

  beforeAll(async () => {
    const migrated = await startMigratedClickHouse();
    ch = migrated.client;
    database = `${migrated.database}_pass_keys_memory`;
    const source = `${database}.trace_summaries`;

    await ch.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    await ch.command({ query: `CREATE DATABASE ${database}` });
    await ch.command({ query: `CREATE TABLE ${source} AS ${migrated.database}.trace_summaries` });
    // Each part stays a separate input of the view's merge, as on a project between merges.
    await ch.command({ query: `SYSTEM STOP MERGES ${source}` });
    for (const statementText of LangWatchQLAppFunctionStatementsService.create().functionStatements()) {
      await ch.command({ query: statementText });
    }
    const traces = LWQL_VIEW_CATALOG.find((view) => view.name === "traces");
    if (!traces) throw new Error("the shipped catalogue has no traces view");
    // The view and its trace-ids twin, as provisioning emits them.
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
    for (const query of setup) {
      await ch.command({ query });
    }

    const total = PARTS * ROWS_PER_PART;
    for (let part = 0; part < PARTS; part++) {
      await ch.command({
        query:
          `INSERT INTO ${source} (TenantId, TraceId, Version, Attributes, OccurredAt, CreatedAt, UpdatedAt) ` +
          `SELECT 'tenant-pass-memory', lower(hex(cityHash64(number))) || lower(hex(cityHash64(number, 1))), '1', ` +
          `mapUpdate(CAST(mapFromArrays(arrayMap(i -> concat('metadata.key_', toString(i)), range(${ATTRIBUTE_KEYS})), ` +
          `arrayMap(i -> repeat('v', 40), range(${ATTRIBUTE_KEYS}))) AS Map(String, String)), ` +
          `map('gen_ai.conversation.id', concat('thread-', toString(number % 997)))), ` +
          `toDateTime64('${START}', 3) + toIntervalMillisecond(intDiv(number * 5184000000, ${total})), ` +
          `toDateTime64('${START}', 3), toDateTime64('${START}', 3) ` +
          `FROM numbers(${part * ROWS_PER_PART}, ${ROWS_PER_PART}) ORDER BY number`,
        clickhouse_settings: {
          max_insert_block_size: INSERT_BLOCK_ROWS,
          min_insert_block_size_rows: INSERT_BLOCK_ROWS,
          max_block_size: INSERT_BLOCK_ROWS,
        },
      });
    }

    statement =
      `SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId, OccurredAt, ` +
      `eval(llm_readable_trace(TraceId, 8000), 'Did the user get what they asked for?') AS q1\n` +
      `FROM ${database}.traces\n` +
      `WHERE OccurredAt >= '${WINDOW.from}' AND OccurredAt < '${WINDOW.to}'\n` +
      `ORDER BY TraceId`;
  }, 240_000);

  afterAll(async () => {
    await ch.command({ query: `DROP DATABASE IF EXISTS ${database}` });
  });

  async function capped(query: string, parameters: Record<string, unknown>): Promise<KeyRow[]> {
    const result = await ch.query({
      query,
      query_params: parameters,
      format: "JSONEachRow",
      clickhouse_settings: CAPPED,
    });
    return result.json<KeyRow>();
  }

  /** The same keys read straight from the seeded table, which holds one version per trace. */
  async function expectedKeys({ where, limit }: { where: string; limit: number }) {
    return capped(
      `SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId, OccurredAt ` +
        `FROM ${database}.trace_summaries ` +
        `WHERE OccurredAt >= '${WINDOW.from}' AND OccurredAt < '${WINDOW.to}' AND ${where} ` +
        `ORDER BY TraceId LIMIT ${limit}`,
      {},
    );
  }

  /** The pass as the service runs it: every query it sends goes through `capped`. */
  async function runPass(pass: LangWatchQLPass): Promise<KeyRow[]> {
    const result = await LangWatchQLPassRunService.create().run({
      sql: statement,
      pass,
      database,
      views: LWQL_VIEW_CATALOG,
      query: async (composed) => ({ rows: await capped(composed.sql, { ...composed.parameters }) }),
    });
    return result.rows;
  }

  describe("when the sample pass runs under the memory cap", () => {
    /** @scenario "An Instant Evals key or sample pass picks its rows before reading the thread id" */
    it("answers with the sampled keys under the cap", async () => {
      const rows = await runPass({
        kind: "sample",
        keyColumns: ["ThreadId", "OccurredAt"],
        limit: 50,
        buckets: SAMPLE_BUCKETS,
      });

      expect(rows).toHaveLength(50);
      expect(rows).toEqual(
        await expectedKeys({ where: `cityHash64(TraceId) % ${SAMPLE_BUCKETS} = 0`, limit: 50 }),
      );
    });
  });

  describe("when a later page of the key pass runs under the memory cap", () => {
    /** @scenario "An Instant Evals key or sample pass picks its rows before reading the thread id" */
    it("answers with the page's keys under the cap", async () => {
      const rows = await runPass({
        kind: "keys",
        keyColumns: ["ThreadId", "OccurredAt"],
        limit: 501,
        after: { traceId: "8", spanId: null },
      });

      expect(rows).toHaveLength(501);
      expect(rows).toEqual(await expectedKeys({ where: "TraceId > '8'", limit: 501 }));
    });
  });

  describe("when the keys are read in one pass that projects the thread id for every trace", () => {
    /** @scenario "An Instant Evals key or sample pass picks its rows before reading the thread id" */
    it("exceeds the cap, which is what the ids-first passes avoid", async () => {
      const singleRead =
        `SELECT q.TraceId AS TraceId, q.ThreadId AS ThreadId, q.OccurredAt AS OccurredAt\n` +
        `FROM (\n${statement}\n) AS q\n` +
        `WHERE cityHash64(q.TraceId) % ${SAMPLE_BUCKETS} = 0\nORDER BY q.TraceId\nLIMIT 50`;

      await expect(capped(singleRead, {})).rejects.toMatchObject({ code: MEMORY_LIMIT_EXCEEDED });
    });
  });
});
