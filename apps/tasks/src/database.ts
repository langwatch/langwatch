import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaDriverAdapterService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";

import type { TasksConfig, TasksDatabase } from "./config.ts";
import { holdMigrationLock } from "./migration-lock.ts";

/**
 * Connects at the one site the URL exists — inside the boot seam's
 * `secrets.into(...)` closure. Only the open connection escapes.
 */
export function openTasksDatabase(databaseUrl: string, config: TasksConfig): TasksDatabase {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:tasks:database"),
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl,
      log: config.nodeEnvironment === "development" ? ["error", "warn"] : ["error"],
    }),
  );
  // Session-scoped advisory locks need their own connection for the sequence.
  const { pool } = PrismaDriverAdapterService.create().create(databaseUrl);

  return {
    client: connection.client,
    hold: (run) => holdMigrationLock(pool, run),
    close: async () => {
      await pool.end();
      await PrismaShutdownService.create().shutdown(connection);
    },
  };
}
