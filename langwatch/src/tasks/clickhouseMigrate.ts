import { runMigrationsIfConfigured } from "../server/clickhouse/goose";

export default async function execute() {
  await runMigrationsIfConfigured({ verbose: true });
}
