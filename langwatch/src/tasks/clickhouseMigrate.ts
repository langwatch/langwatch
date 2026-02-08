import { runMigrationsIfConfigured } from "../server/clickhouse/goose";
import { reconcileTTL } from "../server/clickhouse/ttlReconciler";

export default async function execute() {
  await runMigrationsIfConfigured({ verbose: true });
  await reconcileTTL({ verbose: true });
}
