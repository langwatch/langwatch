import type {
  MigrationPassSummary,
  TenantMigrationRecord,
} from "@langwatch/system-migrations";
import { vi } from "vitest";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../identity/migration-name";
import {
  SystemMigrationsService,
  type SystemMigrationTarget,
} from "../system-migrations.service";

export function createIdentityMigrationFixture() {
  const records = new Map<string, TenantMigrationRecord>();
  const runTargetedPass = vi.fn(
    async (target: SystemMigrationTarget): Promise<MigrationPassSummary> => {
      if (!("userId" in target)) {
        throw new Error("This fixture only adopts users");
      }
      records.set(target.userId, {
        tenantId: target.userId,
        migrationName: target.migrationName,
        status: "finalized",
        report: null,
      });
      return {
        tenantsSeen: 1,
        finalized: 1,
        held: 0,
        finiteHeld: 0,
        parked: 0,
        skipped: 0,
        alreadyFinalized: 0,
        alreadyRolledBack: 0,
        claimed: 0,
        advanced: 1,
      };
    },
  );
  const service = new SystemMigrationsService({
    state: {
      findStatusCounts: async () => ({
        pending: 0,
        migrated: 0,
        finalized: 0,
        rolled_back: 0,
        parked: 0,
      }),
      findRecordsByStatus: async () => [],
      findRecord: async ({ tenantId }) => records.get(tenantId) ?? null,
      upsertRecord: async (record) => {
        records.set(record.tenantId, record);
      },
    },
    migrations: () => [
      {
        name: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        title: "Identity adoption",
        description: "Adopt existing sign-in methods",
        requiresOperatorConfirmation: false,
        runsAutomaticallyOnSelfHosted: true,
        enrolledAutomatically: false,
        tenant: "user",
      },
    ],
    isSaaS: () => false,
    enrollments: {
      findAll: async () => [],
      findOrganizationById: async () => null,
      isEnrolled: async () => false,
      countEnrolledByMigration: async () => new Map(),
      countOrganizations: async () => 0,
      searchOrganizations: async () => [],
      create: async () => {},
      findCohortEligibleOrganizations: async () => [],
      createMany: async () => ({ insertedCount: 0 }),
      delete: async () => {},
    },
    privateDataplaneOrganizationIds: () => [],
    audit: async () => {},
    runPass: async () => {
      throw new Error("An arrival must not run a fleet-wide pass");
    },
    runTargetedPass,
  });
  return { service, records, runTargetedPass };
}
