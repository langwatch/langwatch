import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { TasksConfig } from "./config.ts";

export async function withDatabase(
  config: TasksConfig,
  run: (database: PrismaClient) => Promise<void>,
): Promise<void> {
  const databaseUrl = config.databaseUrl?.trim();
  if (!databaseUrl) throw new Error("This task needs DATABASE_URL");

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:tasks:database"),
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl,
      log: config.nodeEnvironment === "development" ? ["error", "warn"] : ["error"],
    }),
  );
  try {
    await run(connection.client);
  } finally {
    await PrismaShutdownService.create().shutdown(connection);
  }
}
