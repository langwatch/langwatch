import type { SystemMigrationStateRepository } from "@langwatch/system-migrations";

import { type MovedTenantSteps, OpsMigrationRepository } from "../ops-migration.repository.ts";
import type { MemorySystemMigrationEnrollmentRepository } from "./memory.system-migration-enrollment.repository.ts";
import type { MemorySystemMigrationStateRepository } from "./memory.system-migration-state.repository.ts";

/** The copy twin: ops' legacy state and enrolment twins into the moved step's twins. */
export class MemoryOpsMigrationRepository extends OpsMigrationRepository {
  static create(stores: {
    legacy: Pick<MemorySystemMigrationStateRepository, "recordsOf">;
    steps: Pick<SystemMigrationStateRepository, "getRecord" | "upsertRecord">;
    enrolments: Pick<
      MemorySystemMigrationEnrollmentRepository,
      "findAll" | "isEnrolled" | "createMany"
    >;
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

  async copyEnrolments({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    let copied = 0;
    for (const {
      organizationId,
      migrationName,
      enrolledByUserId,
    } of await this.stores.enrolments.findAll()) {
      const stepId = Object.hasOwn(moves, migrationName) ? moves[migrationName] : undefined;
      if (stepId === undefined) continue;
      if (await this.stores.enrolments.isEnrolled({ organizationId, migrationName: stepId }))
        continue;
      copied += 1;
      if (!dryRun) {
        await this.stores.enrolments.createMany({
          organizationIds: [organizationId],
          migrationName: stepId,
          enrolledByUserId,
        });
      }
    }
    return copied;
  }
}
