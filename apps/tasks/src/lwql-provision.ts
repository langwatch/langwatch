import { LwqlProvisionTask } from "@langwatch/analytics-process";
import { createLogger } from "@langwatch/observability";

import type { TaskInput } from "./config.ts";

export async function lwqlProvision({
  config,
  connections,
  environment,
  signal,
}: TaskInput): Promise<void> {
  if (config.skipLwqlProvision) {
    createLogger("langwatch:tasks:lwql-provision").info(
      "SKIP_LWQL_PROVISION=true — skipping LangWatchQL provisioning",
    );
    return;
  }

  const database = connections.database;
  if (!database) throw new Error("This task needs DATABASE_URL");

  await LwqlProvisionTask.create({ database: () => database.client, source: environment }).run({
    args: [],
    signal,
  });
}
