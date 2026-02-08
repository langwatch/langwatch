import { runMigrations } from "../server/clickhouse/goose";
import { reconcileTTL } from "../server/clickhouse/ttlReconciler";

export default async function execute() {
  await runMigrations({ verbose: true });
  await reconcileTTL({ verbose: true });
}
