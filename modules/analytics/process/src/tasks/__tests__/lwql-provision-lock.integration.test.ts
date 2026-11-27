/**
 * The self-provision advisory lock in a Postgres database of its own: the key is global per
 * database, so a shared one lets a sibling suite's converge hold it mid-assertion. A native server
 * gets a throwaway database; otherwise a container. ClickHouse is a recording port; DDL is skipped.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLProductionProvisioningService } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlSelfProvisionRequest,
} from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { TEST_POSTGRES_IMAGE } from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { convergeLwqlAccessModel, type LwqlConvergencePlan } from "../lwql-provision.task.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const nativeDatabaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
let container: StartedPostgreSqlContainer | null = null;
let server: PrismaConnection | null = null;
let ownDatabase: string | null = null;
let databaseUrl = "";
let connection: PrismaConnection | null = null;

function connect(url: string): PrismaConnection {
  return PrismaConnectionService.create({
    guard: new AllowTestQueries(),
    logger: createLogger("lwql-provision-lock-test"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: url, log: ["error"] }));
}

/** A database no other suite uses: a fresh one on the native server, or a container. */
async function ownPostgres(): Promise<string> {
  if (!nativeDatabaseUrl) {
    container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE)
      .withLabels({ "langwatch.test": "true", "langwatch.test.type": "integration" })
      .withStartupTimeout(120_000)
      .start();
    return container.getConnectionUri();
  }
  ownDatabase = `lwql_lock_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  server = connect(nativeDatabaseUrl);
  await server.client.$executeRawUnsafe(`CREATE DATABASE "${ownDatabase}"`);
  const url = new URL(nativeDatabaseUrl);
  url.pathname = `/${ownDatabase}`;
  return url.toString();
}

/** The key the task's lock hashes; the task keeps it private, so the probe names it too. */
const LOCK_KEY_PROBE =
  "SELECT pg_try_advisory_xact_lock(hashtextextended('lwql:self-provision', 0)) AS acquired";
const STATEMENT_PAUSE_MS = 10;

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function client() {
  if (connection === null) throw new Error("the lock suite's Postgres has not started");
  return connection.client;
}

function database(): LwqlProvisioningDatabase {
  return {
    // The Postgres DDL outside the lock is not this suite's subject.
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async () => [],
    $transaction: (fn, options) => client().$transaction((tx) => fn(tx), options),
  };
}

/** One pod's plan: every ClickHouse statement is recorded and takes a moment to run. */
function podPlan({
  onBodyStart,
  onBodyEnd,
  hold,
}: {
  onBodyStart: () => void;
  onBodyEnd: () => void;
  hold?: Promise<void>;
}): LwqlConvergencePlan {
  const source = {
    CLICKHOUSE_URL: "http://admin:secret@127.0.0.1:8123/langwatch",
    LWQL_CLICKHOUSE_PASSWORD: "restricted-lock-secret",
    LWQL_POSTGRES_READER_PASSWORD: "reader-lock-secret",
    DATABASE_URL: databaseUrl,
  };
  const request = selfProvisioning.request({ source }) as Extract<
    LwqlSelfProvisionRequest,
    { complete: true }
  >;
  const names = lwqlProvisioning.names({ connection: request.connection });

  return {
    request,
    names,
    sourceDatabase: () => names.database,
    schema: "public",
    settings: source,
    openRepository: () => {
      onBodyStart();
      const repository = ClickHouseLangWatchQLProvisioningRepository.create({
        statements: {
          async command() {
            await delay(STATEMENT_PAUSE_MS);
          },
          async rows() {
            await hold;
            await delay(STATEMENT_PAUSE_MS);
            return [];
          },
          async insert() {},
        },
      });
      const close = repository.close.bind(repository);

      return Object.assign(repository, {
        close: async () => {
          onBodyEnd();
          await close();
        },
      });
    },
  };
}

beforeAll(async () => {
  databaseUrl = await ownPostgres();
  connection = connect(databaseUrl);
}, 180_000);

afterAll(async () => {
  await connection?.closeOnce();
  if (server && ownDatabase) {
    await server.client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${ownDatabase}" WITH (FORCE)`);
  }
  await server?.closeOnce();
  await container?.stop();
});

describe("LangWatchQL self-provision lock", () => {
  describe("given two pods run the convergence at the same time", () => {
    /** @scenario "Concurrent self-provision runs are serialized by the advisory lock" */
    it("never overlaps the two locked bodies and finishes one before the other starts", async () => {
      const events: string[] = [];
      const run = (pod: "a" | "b") =>
        convergeLwqlAccessModel({
          database: database(),
          plan: podPlan({
            onBodyStart: () => events.push(`start:${pod}`),
            onBodyEnd: () => events.push(`end:${pod}`),
          }),
        });

      await Promise.all([run("a"), run("b")]);

      const first = events[0] === "start:a" ? "a" : "b";
      const second = first === "a" ? "b" : "a";
      expect(events).toEqual([
        `start:${first}`,
        `end:${first}`,
        `start:${second}`,
        `end:${second}`,
      ]);
    });
  });

  describe("given a pod holds the lock inside its transaction", () => {
    /** @scenario "The lock is a transaction-scoped Postgres advisory lock on the global key" */
    it("refuses the same key to another connection while held and frees it when the transaction ends", async () => {
      let release: () => void = () => {};
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holders: Promise<void>[] = [];
      const started = new Promise<void>((resolve) => {
        holders.push(
          convergeLwqlAccessModel({
            database: database(),
            plan: podPlan({ onBodyStart: resolve, onBodyEnd: () => {}, hold }),
          }),
        );
      });
      await started;
      await delay(STATEMENT_PAUSE_MS);

      const tryKey = () =>
        client().$transaction(async (tx) => {
          const [row] = await tx.$queryRawUnsafe<{ acquired: boolean }[]>(LOCK_KEY_PROBE);
          return row?.acquired;
        });

      expect(await tryKey()).toBe(false);

      release();
      await Promise.all(holders);

      expect(await tryKey()).toBe(true);
    });
  });
});
