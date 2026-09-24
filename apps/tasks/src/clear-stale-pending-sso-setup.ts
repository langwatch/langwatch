import { ClearStalePendingSsoSetupTask } from "@langwatch/auth-process";

import type { TaskInput } from "./config.ts";

export async function clearStalePendingSsoSetup({
  connections,
  environment,
  signal,
}: TaskInput): Promise<void> {
  const database = connections.database;
  if (!database) throw new Error("This task needs DATABASE_URL");

  await ClearStalePendingSsoSetupTask.create({ database: () => database.client }).run({
    args: environment.DRY_RUN === "1" ? ["--dry-run"] : [],
    signal,
  });
}
