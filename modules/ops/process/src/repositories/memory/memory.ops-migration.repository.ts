import type { SystemMigrationStateRepository } from "@langwatch/system-migrations";

import { type MovedTenantSteps, OpsMigrationRepository } from "../ops-migration.repository.ts";
import type { MemorySystemMigrationStateRepository } from "./memory.system-migration-state.repository.ts";

/** The copy twin: ops' legacy state twin into the framework's tenant step state twin. */
export class MemoryOpsMigrationRepository extends OpsMigrationRepository {
  static create(stores: {
    legacy: Pick<MemorySystemMigrationStateRepository, "recordsOf">;
    steps: Pick<SystemMigrationStateRepository, "getRecord" | "upsertRecord">;
  }): MemoryOpsMigrationRepository {
    return new MemoryOpsMigrationRepository(stores);
  }

  private constructor(
    private readonly stores: Parameters<typeof MemoryOpsMigrationRepository.create>[0],
  ) {
    super();
  }

  async copyTenantState({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    let copied = 0;
    for (const [legacyName, stepId] of Object.entries(moves)) {
      for (const record of this.stores.legacy.recordsOf({ migrationName: legacyName })) {
        if (record.status !== "finalized" && record.status !== "rolled_back") continue;
        const present = await this.stores.steps
          .getRecord({ migrationName: stepId, tenantId: record.tenantId })
          .then(() => true)
          .catch(() => false);
        if (present) continue;
        copied += 1;
        if (!dryRun) await this.stores.steps.upsertRecord({ ...record, migrationName: stepId });
      }
    }
    return copied;
  }
}
