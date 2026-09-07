import type { Logger } from "@langwatch/observability";
import type { MigrationLockPort } from "./migration-lock.port.ts";

/**
 * The tasks that change a schema, and so must not run beside a copy of
 * themselves. Everything else in the catalogue is a backfill or a report: it
 * takes its own locks if it needs one, and waiting on the migration mutex
 * would only make a long job block a deploy.
 */
export const MIGRATION_TASK_NAMES: readonly string[] = [
  "prisma-migrate",
  "clickhouse-migrate",
  "lwql-provision",
];

export function isMigrationTask(name: string): boolean {
  return MIGRATION_TASK_NAMES.includes(name);
}

/**
 * Runs the migration step with the lock held, and says one thing about it:
 * that it is waiting, and only when it actually had to wait. A run that takes
 * the lock straight away is silent, because "took a lock nobody wanted" is
 * not news.
 */
export class MigrationLockService {
  private constructor(
    private readonly lock: MigrationLockPort,
    private readonly logger: Logger,
  ) {}

  static create({ lock, logger }: { lock: MigrationLockPort; logger: Logger }) {
    return new MigrationLockService(lock, logger);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (!(await this.lock.tryAcquire())) {
      this.logger.info("waiting for migration lock held by another runner");
      await this.lock.acquire();
    }
    try {
      return await work();
    } finally {
      await this.lock.release();
    }
  }
}
