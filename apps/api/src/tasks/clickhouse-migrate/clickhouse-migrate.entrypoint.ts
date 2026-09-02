import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { runClickHouseMigrationTask } from "./clickhouse-migrate.task";

/**
 * The runnable ClickHouse schema migration —
 * `pnpm --filter @langwatch/platform-api task:clickhouse-migrate`.
 *
 * A deploy runs this before the API serves, so the exit status is the whole
 * contract: a non-zero status must stop the rollout. The failure is logged
 * here because nothing below this line reports it — the task throws and the
 * process would otherwise die with an unhandled rejection and no statement of
 * which endpoint refused.
 */
void runClickHouseMigrationTask(process.env).catch((error: unknown) => {
  createLogger("langwatch:task:clickhouse-migrate").error(
    { error },
    "ClickHouse migrations failed",
  );
  process.exitCode = 1;
});
