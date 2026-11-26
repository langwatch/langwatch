/**
 * An install with no LangWatchQL password derives both from the key pepper, in `sql` mode.
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
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { withLwqlDefaultCredentials } from "../../rules/lwql-default-credentials.rules.ts";
import { LwqlProvisionTask } from "../lwql-provision.task.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const enabled = Boolean(process.env.LANGWATCH_TEST_CLICKHOUSE_URL) && Boolean(databaseUrl);
const UNMAPPED_KEY_HASH = "0".repeat(64);

describe.runIf(enabled)("given an install with no LangWatchQL password set", () => {
  let endpoint: { url: string; database: string };
  let admin: ClickHouseClient;
  let restricted: ClickHouseClient;
  let endpointUrl: URL;
  let source: Record<string, string | undefined>;
  const chainPepper = `lwql-default-credentials-chain-${randomUUID()}`;
  const postgres = databaseUrl
    ? PrismaConnectionService.create({
        guard: new AllowTestQueries(),
        logger: createLogger("lwql-default-credentials-test"),
      }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
    : null;

  const database = (): LwqlProvisioningDatabase => {
    if (!postgres) throw new Error("DATABASE_URL is required");
    return {
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async () => [],
      $transaction: (fn, options) => postgres.client.$transaction((tx) => fn(tx), options),
    };
  };

  beforeAll(async () => {
    const [started] = await startTestClickHouseEndpoints({
      suite: "lwql-default-credentials",
      names: ["schema"],
      environment: process.env,
    });
    if (!started) throw new Error("no ClickHouse endpoint was provisioned");
    endpoint = started;
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
    source = {
      CLICKHOUSE_URL: endpoint.url,
      DATABASE_URL: databaseUrl,
      CREDENTIALS_SECRET: `lwql-default-credentials-${randomUUID()}`,
    };
    // The runner's chain answers API_KEY_PEPPER from a source the environment lacks (a .env file).
    const lookup = (id: string) =>
      Promise.resolve(id === "API_KEY_PEPPER" ? chainPepper : source[id]);

    await LwqlProvisionTask.create({ database, source, lookup, failOnError: true }).run({
      args: [],
      signal: new AbortController().signal,
    });

    const derived = withLwqlDefaultCredentials({ ...source, API_KEY_PEPPER: chainPepper });
    endpointUrl = new URL(endpoint.url);
    endpointUrl.username = "";
    endpointUrl.password = "";
    restricted = createClient({
      url: endpointUrl.toString(),
      username: `${endpoint.database}_lwql`,
      password: derived.LWQL_CLICKHOUSE_PASSWORD,
    });
  }, 240_000);

  afterAll(async () => {
    await restricted?.close();
    await admin?.command({ query: `DROP USER IF EXISTS ${endpoint.database}_lwql` });
    await admin?.close();
    await postgres?.closeOnce();
  });

  describe("when the LangWatchQL provisioning task runs", () => {
    /** @scenario "The upgrade task provisions a queryable restricted identity from CLICKHOUSE_URL, DATABASE_URL and the key pepper alone" */
    it("signs the restricted identity in with the derived password and reads a view", async () => {
      const result = await restricted.query({
        query:
          `SELECT count() AS rows FROM ${endpoint.database}.traces ` +
          `SETTINGS custom_api_key_hash = '${UNMAPPED_KEY_HASH}'`,
        format: "JSONEachRow",
      });

      expect(
        (await result.json<{ rows: number | string }>()).map(({ rows }) => Number(rows)),
      ).toEqual([0]);
    });

    /** @scenario "The upgrade task derives from the key pepper the secrets chain resolves" */
    it("refuses the password derived from the environment's weaker pepper source", async () => {
      const fromEnvironmentOnly = createClient({
        url: endpointUrl.toString(),
        username: `${endpoint.database}_lwql`,
        password: withLwqlDefaultCredentials(source).LWQL_CLICKHOUSE_PASSWORD,
      });
      try {
        await expect(fromEnvironmentOnly.query({ query: "SELECT 1" })).rejects.toMatchObject({
          type: "AUTHENTICATION_FAILED",
        });
      } finally {
        await fromEnvironmentOnly.close();
      }
    });
  });
});
