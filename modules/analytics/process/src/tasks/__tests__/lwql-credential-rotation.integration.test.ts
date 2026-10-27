/**
 * A rotated PostgreSQL reader password reaches the engine tables on a real ClickHouse (#8858).
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_POSTGRES_READER_ROLE } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { isCollectionUnconfirmed } from "../../rules/langwatch-ql-collection-probe.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import {
  convergeLwqlAccessModel,
  findLwqlAppOwnedDrift,
  type LwqlConvergencePlan,
} from "../lwql-provision.task.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const SERVER_LOG = "/var/log/clickhouse-server/clickhouse-server.log";

type LogMark = { at: string; bytes: number };
const ENGINE_TABLES = selfProvisioning.engineTablesIn({ only: undefined });
// Unique per run, so a search of the server's logs finds only this run's leaks.
const FIRST_PASSWORD = `reader-rotation-first-${randomUUID()}`;
const SECOND_PASSWORD = `reader-rotation-second-${randomUUID()}`;

describe("given a rendered install whose engine tables were built on the reader's first password", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let connection: ReturnType<ReturnType<typeof PrismaConnectionService.create>["connect"]>;
  let names: LangWatchQLNames;
  let collection: string;

  const database = (): LwqlProvisioningDatabase => connection.client;

  /** The plan of a worker whose environment carries `readerPassword`. */
  const plan = (readerPassword: string): LwqlConvergencePlan => ({
    request: {
      requested: true,
      complete: true,
      connection: {
        url: "http://127.0.0.1:8123",
        username: names.restrictedUser,
        password: "restricted-rotation-secret",
        database: names.database,
        tenantSetting: names.tenantSetting,
      },
      postgresReaderPassword: readerPassword,
      endpoint: {
        host: postgres.container.getIpAddress("bridge"),
        port: 5432,
        database: postgres.container.getDatabase(),
      },
    },
    names,
    sourceDatabase: () => names.database,
    schema: "public",
    // The image's one-replica `default` cluster: the reads take the clustered form.
    settings: { LWQL_ACCESS_MODEL_MODE: "rendered", CLICKHOUSE_CLUSTER: "default" },
    // The deploy task's own client, so the probes' parameters travel as they do in production.
    openRepository: () =>
      ClickHouseLangWatchQLProvisioningRepository.open({
        url: harness.container.getConnectionUrl(),
      }),
  });

  /** The SQL stand-in for the collection file the config store loads. */
  const collectionHolds = (password: string) =>
    harness.applyAsAdmin([
      `DROP NAMED COLLECTION IF EXISTS ${collection}`,
      `CREATE NAMED COLLECTION ${collection} AS host = '${postgres.container.getIpAddress("bridge")}', ` +
        `port = 5432, database = '${postgres.container.getDatabase()}', ` +
        `user = '${LWQL_POSTGRES_READER_ROLE}', password = '${password}'`,
    ]);

  const deploy = (readerPassword: string) =>
    convergeLwqlAccessModel({
      database: database(),
      plan: plan(readerPassword),
      failOnError: true,
    });

  const drift = (readerPassword: string) =>
    findLwqlAppOwnedDrift({ database: database(), plan: plan(readerPassword) });

  /** One reconvergence check on a worker whose environment carries `readerPassword`. */
  async function check(readerPassword: string): Promise<"converged" | "left"> {
    const only = await drift(readerPassword);
    try {
      await convergeLwqlAccessModel({
        database: database(),
        plan: plan(readerPassword),
        failOnError: true,
        only,
      });
      return "converged";
    } catch (error) {
      if (isCollectionUnconfirmed(error)) return "left";
      throw error;
    }
  }

  /** Each engine table's UUID: `CREATE OR REPLACE` gives a new one. */
  async function engineTableIds(): Promise<Record<string, string>> {
    const result = await harness.admin.query({
      query:
        "SELECT name, toString(uuid) AS id FROM system.tables " +
        "WHERE database = {database:String} AND engine = 'PostgreSQL'",
      query_params: { database: names.database },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ name: string; id: string }>();
    return Object.fromEntries(rows.map((row) => [row.name, row.id]));
  }

  /** Ends every reader backend, so the next read opens a connection with the pool's values. */
  async function endReaderConnections(): Promise<void> {
    const result = await postgres.asAdmin(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${LWQL_POSTGRES_READER_ROLE}'`,
    );
    if (result.exitCode !== 0) throw new Error(`ending reader backends failed: ${result.stderr}`);
  }

  /** The reader's backends PostgreSQL started before `instant`, by its own clock. */
  async function readerBackendsStartedBefore(instant: Date): Promise<unknown[]> {
    return connection.client.$queryRawUnsafe(
      "SELECT pid, backend_start, state FROM pg_stat_activity " +
        "WHERE usename = $1 AND backend_start < $2",
      LWQL_POSTGRES_READER_ROLE,
      instant,
    );
  }

  async function postgresNow(): Promise<Date> {
    const [row] = await connection.client.$queryRawUnsafe<{ now: Date }[]>(
      "SELECT clock_timestamp() AS now",
    );
    if (!row) throw new Error("PostgreSQL answered no clock");
    return row.now;
  }

  /**
   * Every place this run's ClickHouse logs could hold a password: query, text and file logs. The
   * logs are read out and searched here; a search sent as SQL would log the values it looks for.
   */
  async function loggedPasswords(since: LogMark): Promise<string[]> {
    await harness.admin.command({ query: "SYSTEM FLUSH LOGS" });
    const read = async (log: string, column: string) => {
      const result = await harness.admin.query({
        query: `SELECT ${column} AS line FROM system.${log} WHERE event_time >= {since:DateTime}`,
        query_params: { since: since.at },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ line: string }>();
      return rows.map((row) => ({ log, line: row.line }));
    };
    const file = await harness.container.exec(["tail", "-c", `+${since.bytes + 1}`, SERVER_LOG]);
    const lines = [
      ...(await read("query_log", "query")),
      ...(await read("text_log", "message")),
      ...file.output.split("\n").map((line) => ({ log: "server log file", line })),
    ];
    const leaks = lines.filter(({ line }) =>
      [FIRST_PASSWORD, SECOND_PASSWORD].some((password) => line.includes(password)),
    );
    return [...new Set(leaks.map(({ log }) => log))];
  }

  /** Where this run's logging starts: a second on the server's clock, a byte in its log file. */
  async function markLogs(): Promise<LogMark> {
    const result = await harness.admin.query({
      query: "SELECT now() AS at",
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ at: string }>();
    const size = await harness.container.exec(["stat", "-c", "%s", SERVER_LOG]);
    return { at: row?.at ?? "", bytes: Number(size.output.trim()) };
  }

  async function answers(): Promise<number[]> {
    return Promise.all(
      ENGINE_TABLES.map(async (table) => {
        const result = await harness.admin.query({
          query: `SELECT count() AS n FROM ${names.database}.${table}`,
          format: "JSONEachRow",
        });
        const [row] = await result.json<{ n: string }>();
        return Number(row?.n);
      }),
    );
  }

  beforeAll(async () => {
    [harness, postgres] = await Promise.all([
      startLangWatchQLClickHouse({ suite: "credential-rotation", facts: "migrated" }),
      startLangWatchQLPostgres(),
    ]);
    connection = PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("lwql-credential-rotation-test"),
    }).connect(
      PrismaConfigService.create().resolve({
        databaseUrl: postgres.container.getConnectionUri(),
        log: ["error"],
      }),
    );
    names = { ...harness.names, database: harness.factDatabase };
    collection = selfProvisioning.namedCollection({ names });
    // A reused container keeps the facts database, so the app-owned objects go first.
    await harness.applyAsAdmin([
      ...LWQL_VIEW_CATALOG.map((view) => `DROP VIEW IF EXISTS ${names.database}.${view.name}`),
      ...ENGINE_TABLES.map((table) => `DROP TABLE IF EXISTS ${names.database}.${table}`),
    ]);
    await collectionHolds(FIRST_PASSWORD);
    await deploy(FIRST_PASSWORD);
  }, 600_000);

  afterAll(async () => {
    // A reused container reloads each table at restart; one whose collection is gone never loads.
    await harness?.applyAsAdmin([
      ...ENGINE_TABLES.map((table) => `DROP TABLE IF EXISTS ${names.database}.${table}`),
      `DROP NAMED COLLECTION IF EXISTS ${collection}`,
    ]);
    await connection?.closeOnce();
    await Promise.all([harness?.stop(), postgres?.stop()]);
  });

  describe("when the password changes and a deploy converges before ClickHouse loads it", () => {
    /** @scenario "A rotated reader password reaches the engine tables without a ClickHouse restart" */
    it("waits for the new collection, then rebuilds every engine table on it, and an older worker rebuilds nothing", async () => {
      expect((await drift(FIRST_PASSWORD)).clickHouse).toEqual([]);
      const logsFrom = await markLogs();
      // Pooled connections on the first password, which no rebuild may leave open.
      await answers();
      expect(await readerBackendsStartedBefore(await postgresNow())).not.toEqual([]);

      // The deploy sets the role's new password; the collection file still holds the first one.
      await deploy(SECOND_PASSWORD);
      expect((await drift(SECOND_PASSWORD)).clickHouse).toEqual(ENGINE_TABLES);
      const waiting = await engineTableIds();
      expect(await check(SECOND_PASSWORD)).toBe("left");
      expect(await engineTableIds()).toEqual(waiting);
      // The failure #8858 fixes: a table built on the old values cannot open a connection.
      await expect(answers()).rejects.toThrow(/password authentication failed/);

      await collectionHolds(SECOND_PASSWORD);
      const rebuildStarted = await postgresNow();
      expect(await check(SECOND_PASSWORD)).toBe("converged");
      const rebuilt = await engineTableIds();
      for (const table of ENGINE_TABLES) expect(rebuilt[table]).not.toBe(waiting[table]);
      expect((await drift(SECOND_PASSWORD)).clickHouse).toEqual([]);
      // No connection opened on the old values outlives the rebuild.
      expect(await readerBackendsStartedBefore(rebuildStarted)).toEqual([]);
      await endReaderConnections();
      const answered = await answers();
      expect(answered.every((count) => Number.isInteger(count))).toBe(true);

      // A worker still on the first password cannot authenticate with it, so it leaves them.
      expect(await check(FIRST_PASSWORD)).toBe("left");
      expect(await engineTableIds()).toEqual(rebuilt);
      expect((await drift(SECOND_PASSWORD)).clickHouse).toEqual([]);

      // Every probe sent the password as a body parameter, which ClickHouse never logs.
      expect(await loggedPasswords(logsFrom)).toEqual([]);
    });
  });
});
