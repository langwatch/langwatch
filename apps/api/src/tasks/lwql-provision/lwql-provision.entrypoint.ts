import process from "node:process";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";

import {
  runLwqlProvisioningTask,
  type LwqlProvisioningDatabase,
} from "./lwql-provision.task";

/**
 * The runnable LangWatchQL provisioning —
 * `pnpm --filter @langwatch/platform-api task:lwql-provision`.
 *
 * A deploy runs this after the ClickHouse migration, so the exit status is the
 * whole contract: the key-map backfill failing leaves pre-existing projects
 * answering every LangWatchQL query with zero rows and HTTP 200, which nothing
 * in the request path detects, so a non-zero status has to stop the rollout.
 */

const logger = createLogger("langwatch:task:lwql-provision");

function connect(env: NodeJS.ProcessEnv): LwqlProvisioningDatabase {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("LangWatchQL provisioning needs a database: set DATABASE_URL.");
  }
  return PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(
    PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
  ).client as unknown as LwqlProvisioningDatabase;
}

void runLwqlProvisioningTask({ database: connect(process.env) }).catch((error: unknown) => {
  logger.error({ error }, "LangWatchQL provisioning failed");
  process.exitCode = 1;
});
