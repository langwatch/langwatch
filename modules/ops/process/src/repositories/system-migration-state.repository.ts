import type { SystemMigrationStateRepository as RunnerStateRepository } from "@langwatch/system-migrations";

import type { SystemMigrationStateReader } from "../rules/system-migration-support.rules.ts";

/** The per-(migration, tenant) ledger: the runner's port, the console's reads, the re-drive. */
export interface SystemMigrationStateRepository
  extends RunnerStateRepository, SystemMigrationStateReader {
  /** Whether a later pass could still move a tenant (`parked`, `migrated`) in these migrations. */
  hasTenantAwaitingRedrive(args: { migrationNames: readonly string[] }): Promise<boolean>;
}
