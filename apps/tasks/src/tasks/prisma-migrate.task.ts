import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:tasks:prisma-migrate");

/**
 * Applies pending Postgres migrations. Lifted from apps/api's
 * `task:prisma-migrate` script: spawns the Prisma CLI against
 * `@langwatch/prisma-client`'s history, honouring `SKIP_PRISMA_MIGRATE` to opt out.
 */
export class PrismaMigrateTask extends Task {
  readonly name = "prisma-migrate";
  readonly description = "Applies pending Postgres migrations via `prisma migrate deploy`.";

  static create(): PrismaMigrateTask {
    return new PrismaMigrateTask();
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    if (process.env.SKIP_PRISMA_MIGRATE === "true") {
      logger.info("SKIP_PRISMA_MIGRATE=true — skipping Prisma migrations");
      return;
    }

    // This process's own config, not `@langwatch/prisma-client`'s: the package
    // config carries no datasource on purpose, and `prisma migrate deploy`
    // refuses to run without one. `apps/tasks/prisma.config.ts` points at the
    // package's schema and migration history and attaches `DATABASE_URL`.
    const configPath = fileURLToPath(new URL("../../prisma.config.ts", import.meta.url));

    await new Promise<void>((resolve, reject) => {
      const child = spawn("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", configPath], {
        stdio: "inherit",
        env: process.env,
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`prisma migrate deploy exited with code ${code}`));
      });
    });
  }
}
