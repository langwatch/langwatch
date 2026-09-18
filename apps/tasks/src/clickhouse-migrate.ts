import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";

import type { TaskInput } from "./config.ts";

export async function clickhouseMigrate({ environment, signal }: TaskInput): Promise<void> {
  await ClickHouseMigrateTask.create({ source: environment }).run({ args: [], signal });
}
