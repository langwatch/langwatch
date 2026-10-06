/**
 * The self-provision advisory lock under a real Postgres: the lock transaction runs on real
 * connections, the ClickHouse side is the real repository over a recording port, and the
 * Postgres DDL is skipped so the shared test database keeps no LangWatchQL views.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, describe, expect, it } from "vitest";

import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import { LangWatchQLProductionProvisioningService } from "../../services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlSelfProvisionRequest,
} from "../../services/langwatch-ql-self-provisioning.service.ts";
import {
  convergeLwqlAccessModel,
  type LwqlConvergencePlan,
  type LwqlProvisioningDatabase,
} from "../lwql-provision.task.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("lwql-provision-lock-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

/** The key the task's lock hashes; the task keeps it private, so the probe names it too. */
const LOCK_KEY_PROBE =
  "SELECT pg_try_advisory_xact_lock(hashtextextended('lwql:self-provision', 0)) AS acquired";
const STATEMENT_PAUSE_MS = 10;

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function client() {
  if (connection === null) throw new Error("DATABASE_URL is required for the lock tests");
  return connection.client;
}

function database(): LwqlProvisioningDatabase {
  return {
    // The Postgres DDL outside the lock is not this suite's subject.
    $executeRawUnsafe: async () => 0,
    $transaction: (fn, options) => client().$transaction((tx) => fn(tx), options),
    project: { findMany: async () => [] },
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

afterAll(async () => {
  await connection?.closeOnce();
});

describe.skipIf(!databaseUrl)("LangWatchQL self-provision lock", () => {
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
