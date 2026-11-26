/**
 * A ClickHouse user that cannot manage access (ClickHouse Cloud, a locked-down external server)
 * must not block the upgrade when LangWatchQL's passwords are derived; explicit ones stay fatal.
 * @see modules/analytics/specs/analytics-lwql-default-credentials.feature
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import type * as Observability from "@langwatch/observability";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { LwqlProvisionTask } from "../lwql-provision.task.ts";

const taskWarnings = vi.hoisted(() => [] as { fields: unknown; message: unknown }[]);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string, ...rest: unknown[]) => {
      const logger = (actual.createLogger as (...args: unknown[]) => Observability.Logger)(
        name,
        ...rest,
      );
      if (name !== "langwatch:task:lwql-provision") return logger;
      return new Proxy(logger, {
        get(target, property, receiver) {
          if (property !== "warn") return Reflect.get(target, property, receiver);
          return (fields: unknown, message: unknown) => {
            taskWarnings.push({ fields, message });
            return target.warn(fields as object, message as string);
          };
        },
      });
    },
  };
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const enabled = Boolean(process.env.LANGWATCH_TEST_CLICKHOUSE_URL) && Boolean(databaseUrl);

describe.runIf(enabled)("given a ClickHouse user without access management", () => {
  let admin: ClickHouseClient;
  let lockedDownUrl: string;
  let database: string;
  const lockedDownUser = `lwql_no_grants_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const lockedDownPassword = `pw_${randomUUID()}`;
  const postgres = databaseUrl
    ? PrismaConnectionService.create({
        guard: new AllowTestQueries(),
        logger: createLogger("lwql-provision-missing-grants-test"),
      }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
    : null;

  // The PostgreSQL reader role is server-wide, so its DDL is left out; the lock still runs.
  const provisioningDatabase = (): LwqlProvisioningDatabase => {
    if (!postgres) throw new Error("DATABASE_URL is required");
    return {
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async () => [],
      $transaction: (fn, options) => postgres.client.$transaction((tx) => fn(tx), options),
    };
  };

  const runUpgradeProvisioning = (source: Record<string, string | undefined>) =>
    LwqlProvisionTask.create({ database: provisioningDatabase, source, failOnError: true }).run({
      args: [],
      signal: new AbortController().signal,
    });

  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "lwql-provision-missing-grants",
      names: ["schema"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("no ClickHouse endpoint was provisioned");
    database = endpoint.database;
    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });
    admin = createClient({ url: endpoint.url });
    await admin.command({
      query: `CREATE USER IF NOT EXISTS ${lockedDownUser} IDENTIFIED WITH sha256_password BY '${lockedDownPassword}'`,
    });
    await admin.command({ query: `GRANT SELECT, INSERT ON ${database}.* TO ${lockedDownUser}` });
    await admin.command({ query: `GRANT SELECT ON system.* TO ${lockedDownUser}` });
    const url = new URL(endpoint.url);
    url.username = lockedDownUser;
    url.password = lockedDownPassword;
    lockedDownUrl = url.toString();
  }, 240_000);

  beforeEach(() => {
    taskWarnings.length = 0;
  });

  afterAll(async () => {
    await admin?.command({ query: `DROP USER IF EXISTS ${lockedDownUser}` });
    await admin?.command({ query: `DROP USER IF EXISTS ${database}_lwql` });
    await admin?.close();
    await postgres?.closeOnce();
  });

  describe("when the upgrade provisions LangWatchQL with derived passwords", () => {
    /** @scenario "A ClickHouse user without access management does not block the upgrade under derived passwords" */
    it("completes and warns once, naming the missing grant", async () => {
      await expect(
        runUpgradeProvisioning({
          CLICKHOUSE_URL: lockedDownUrl,
          DATABASE_URL: databaseUrl,
          CREDENTIALS_SECRET: `lwql-missing-grants-${randomUUID()}`,
        }),
      ).resolves.toBeUndefined();

      const refusals = taskWarnings.filter(
        ({ fields }) => (fields as { kind?: unknown })?.kind !== undefined,
      );
      expect(refusals).toHaveLength(1);
      expect(refusals[0]?.fields).toMatchObject({ kind: "missing_grant", store: "clickhouse" });
      expect(String(refusals[0]?.message)).toMatch(/lacks the grant CREATE /);
      expect(String(refusals[0]?.message)).toContain(
        "Dashboards, the SQL workbench and Instant Evals stay unavailable",
      );
    });
  });

  describe("when the upgrade provisions LangWatchQL with explicit passwords", () => {
    /** @scenario "Explicit LangWatchQL passwords keep a missing grant fatal for the upgrade" */
    it("fails with the ClickHouse access refusal", async () => {
      await expect(
        runUpgradeProvisioning({
          CLICKHOUSE_URL: lockedDownUrl,
          DATABASE_URL: databaseUrl,
          LWQL_CLICKHOUSE_PASSWORD: `explicit-${randomUUID()}`,
          LWQL_POSTGRES_READER_PASSWORD: `explicit-${randomUUID()}`,
          LWQL_ACCESS_MODEL_MODE: "sql",
          LWQL_CLICKHOUSE_USER: `${database}_lwql`,
        }),
      ).rejects.toMatchObject({ type: "ACCESS_DENIED" });
    });
  });
});
