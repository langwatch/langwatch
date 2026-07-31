import { createLogger } from "@langwatch/observability";
import { parsePrivateClickHouseUrls } from "../server/app-layer/clients/clickhouse/private-endpoints";
import { runMigrations } from "../server/clickhouse/goose";
import { reconcileTTL } from "../server/clickhouse/ttlReconciler";

const logger = createLogger("langwatch:task:clickhouseMigrate");

export default async function execute() {
  // Run migrations on the shared instance (from CLICKHOUSE_URL)
  await runMigrations({ verbose: true });
  await reconcileTTL({ verbose: true });

  // Run migrations on all private instances. Enumerated from the env vars
  // rather than from the client's `knownTargets()`: goose and the TTL
  // reconciler both connect by URL and neither takes a client, so the targets
  // would have to be re-assembled back into URLs to be handed over.
  const privateUrls = parsePrivateClickHouseUrls();
  for (const [orgId, url] of privateUrls) {
    logger.info({ orgId }, "Running migrations on private ClickHouse instance");
    try {
      await runMigrations({ connectionUrl: url, verbose: true });
      await reconcileTTL({ connectionUrl: url, verbose: true });
    } catch (error) {
      logger.error(
        {
          orgId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to run migrations on private ClickHouse instance",
      );
      throw error;
    }
  }
}
