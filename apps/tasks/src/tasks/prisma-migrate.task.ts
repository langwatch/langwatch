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

  private constructor(
    private readonly skipped: boolean,
    private readonly environment: Readonly<Record<string, string | undefined>>,
  ) {
    super();
  }

  /**
   * `environment` is what the spawned child inherits, not a setting this task
   * reads: the Prisma CLI needs a real PATH to be spawned at all, and it reads
   * `DATABASE_URL` for itself. Taking the boot-resolved record rather than the
   * ambient one is what gets a vault-resolved `DATABASE_URL` to the child.
   */
  static create({
    skipped,
    environment,
  }: {
    skipped: boolean;
    environment: Readonly<Record<string, string | undefined>>;
  }): PrismaMigrateTask {
    return new PrismaMigrateTask(skipped, environment);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    if (this.skipped) {
      logger.info("SKIP_PRISMA_MIGRATE is set — skipping Prisma migrations");
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
        env: { ...this.environment },
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`prisma migrate deploy exited with code ${code}`));
      });
    });
  }
}
