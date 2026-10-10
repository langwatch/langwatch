import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { RETENTION_TTL_MANAGED_TABLES } from "@langwatch/data-retention-contract/retention-tables";

import type { TaskInput } from "./config.ts";

export async function clickhouseMigrate({ environment, signal }: TaskInput): Promise<void> {
  await ClickHouseMigrateTask.create({
    source: environment,
    managedTables: RETENTION_TTL_MANAGED_TABLES,
  }).run({ args: [], signal });
}
