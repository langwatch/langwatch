import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  parseConnectionUrl,
  resolveClickHouseMigrationTaskConfig,
} from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { type UpgradeClickHouse, UpgradeLedgerSeedService } from "@langwatch/upgrade";

import type { TaskInput } from "./config.ts";

/**
 * Seeds the upgrade ledger from `_prisma_migrations` and the shared ClickHouse's
 * `goose_db_version` (plan migrations-rethink-2026-10-06, slice S1). Changes no boot.
 */
export async function upgradeLedgerSeed({ connections, environment }: TaskInput): Promise<void> {
  const database = connections.database;
  if (!database) throw new Error("DATABASE_URL is required to seed the upgrade ledger");
  const sharedUrl = resolveClickHouseMigrationTaskConfig(environment).sharedUrl;
  const client = sharedUrl
    ? createClient({ url: parseConnectionUrl({ connectionUrl: sharedUrl }).databaseUrl })
    : undefined;
  try {
    const run = await UpgradeLedgerSeedService.create({
      postgres: database.sql,
      clickhouse: client ? gooseReader(client) : undefined,
    }).seed();
    createLogger("langwatch:tasks:upgrade-ledger-seed").info(
      { runId: run.id, seeded: run.report?.seeded, clickhouse: client !== undefined },
      "upgrade ledger seeded",
    );
  } finally {
    await client?.close();
  }
}

function gooseReader(client: ClickHouseClient): UpgradeClickHouse {
  return {
    queryRows: async (sql) => (await client.query({ query: sql, format: "JSONEachRow" })).json(),
  };
}
