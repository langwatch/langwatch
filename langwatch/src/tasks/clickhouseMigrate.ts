import { getPrivateClickHouseUrls } from "../server/clickhouse/clickhouseClient";
import { runMigrations } from "../server/clickhouse/goose";
import { reconcileTTL } from "../server/clickhouse/ttlReconciler";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:task:clickhouseMigrate");

export default async function execute() {
  // Run migrations on the shared instance (from CLICKHOUSE_URL)
  await runMigrations({ verbose: true });
  await reconcileTTL({ verbose: true });

  // Run migrations on all private instances
  const privateUrls = getPrivateClickHouseUrls();
  for (const [orgId, url] of privateUrls) {
    logger.info({ orgId }, "Running migrations on private ClickHouse instance");
    try {
      await runMigrations({ connectionUrl: url, verbose: true });
      await reconcileTTL({ connectionUrl: url, verbose: true });
    } catch (error) {
      logger.error(
        { orgId, error: error instanceof Error ? error.message : String(error) },
        "Failed to run migrations on private ClickHouse instance",
      );
      throw error;
    }
  }
}
