import { LwqlProvisionTask } from "@langwatch/analytics-process";
import { createLogger } from "@langwatch/observability";

import type { TaskInput } from "./config.ts";
import { withDatabase } from "./database.ts";

export async function lwqlProvision({ config, environment, signal }: TaskInput): Promise<void> {
  if (config.skipLwqlProvision) {
    createLogger("langwatch:tasks:lwql-provision").info(
      "SKIP_LWQL_PROVISION=true — skipping LangWatchQL provisioning",
    );
    return;
  }

  await withDatabase(config, async (database) => {
    await LwqlProvisionTask.create({ database: () => database, source: environment }).run({
      args: [],
      signal,
    });
  });
}
