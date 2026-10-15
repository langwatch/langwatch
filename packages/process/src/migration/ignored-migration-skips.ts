import type { ServerLogger } from "../server.ts";

/** The previous release's switches that skipped its own migrate scripts, as written. */
export type MigrationSkips = Readonly<{
  skipPrismaMigrate?: string | undefined;
  skipClickHouseMigrate?: string | undefined;
}>;

const isOn = (value: string | undefined) => value?.trim().toLowerCase() === "true";

/** The api waits for the upgrade, so a skip cannot be honoured: the worker says so once at boot. */
export function warnIgnoredMigrationSkips({
  skips,
  logger,
}: {
  skips: MigrationSkips;
  logger: ServerLogger;
}): void {
  const ignored = [
    ...(isOn(skips.skipPrismaMigrate) ? ["SKIP_PRISMA_MIGRATE"] : []),
    ...(isOn(skips.skipClickHouseMigrate) ? ["SKIP_CLICKHOUSE_MIGRATE"] : []),
  ];
  if (ignored.length === 0) return;
  const warn = logger.warn ?? logger.info;
  warn(
    { ignored },
    `${ignored.join(" and ")} ${ignored.length === 1 ? "is" : "are"} ignored: the worker runs the upgrade (\`pnpm task upgrade\`) itself, and the api waits for it.`,
  );
}
