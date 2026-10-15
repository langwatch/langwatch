/** Spec: specs/migration/system-migrations-runner.feature */
import { SCHEDULED_SINGLETON_PROJECT_ID } from "@langwatch/eventing";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import type { TenantStepStateRow } from "@langwatch/upgrade/step/tenant-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER } from "../../../../eventing/ops-system-migrations.process.ts";
import type {
  SystemMigrationStateReader,
  SystemMigrationsServiceDependencies,
} from "../../../../rules/system-migration-support.rules.ts";
import { SystemMigrationsService } from "../system-migrations.service.ts";

const QUIET: MigrationPassSummary = {
  tenantsSeen: 3,
  finalized: 0,
  held: 0,
  parked: 0,
  skipped: 0,
  alreadyFinalized: 0,
  alreadyRolledBack: 0,
  claimed: 0,
  advanced: 0,
};

function heldRow(heldReason: "proof" | "pending"): TenantStepStateRow {
  return {
    migrationName: "step",
    tenantId: "tenant",
    status: "migrated",
    report: null,
    heldReason,
    updatedAt: nowInstant(),
  };
}

function serviceWith({
  passes,
  held = [],
}: {
  passes: MigrationPassSummary[];
  held?: TenantStepStateRow[];
}) {
  const runPass = vi.fn<SystemMigrationsServiceDependencies["runPass"]>();
  for (const pass of passes) runPass.mockResolvedValueOnce(pass);
  runPass.mockResolvedValue(QUIET);
  const requestPass = vi.fn<SystemMigrationsServiceDependencies["requestPass"]>(async () => {});
  const service = SystemMigrationsService.create(
    createApiFixture<SystemMigrationsServiceDependencies>(
      {
        runPass,
        requestPass,
        hasTenantAwaitingRedrive: vi.fn(async () => true),
        state: createApiFixture<SystemMigrationStateReader>(
          { findRecordsByStatus: async () => held },
          "system migration state",
        ),
      },
      "system migration deps",
    ),
  );
  return { service, runPass, requestPass };
}

async function run(promise: Promise<void>): Promise<void> {
  await vi.runAllTimersAsync();
  await promise;
}

describe("SystemMigrationsService.executePass", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("when a pass advances an organization", () => {
    /** @scenario "A worker's pass keeps running while a pass still advances something" */
    it("runs passes until one advances nothing", async () => {
      const { service, runPass } = serviceWith({
        passes: [
          { ...QUIET, advanced: 2 },
          { ...QUIET, advanced: 1 },
        ],
      });

      await run(service.executePass({ redrive: false }));

      expect(runPass).toHaveBeenCalledTimes(3);
    });
  });

  describe("when the run newly holds a tenant", () => {
    /** @scenario "A run that newly holds a tenant leaves the pass pending" */
    it("tells the scheduled process a pass is pending, with no delay of its own", async () => {
      const { service, requestPass } = serviceWith({
        passes: [
          { ...QUIET, advanced: 2, held: 2 },
          { ...QUIET, held: 2 },
        ],
      });

      await run(service.executePass({ redrive: false }));

      expect(requestPass).toHaveBeenCalledOnce();
      expect(requestPass).toHaveBeenCalledWith({
        actorUserId: SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER,
      });
    });

    /** @scenario "A run that newly holds a tenant leaves the pass pending" */
    it("asks under the scheduled singleton's tenant, which the event store can place", () => {
      expect(SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER).toBe(SCHEDULED_SINGLETON_PROJECT_ID);
    });
  });

  describe("when a tenant is held while its queued work drains", () => {
    /** @scenario "A tenant held while its queued work drains is pending" */
    it("tells the scheduled process a pass is pending even though nothing advanced", async () => {
      const { service, requestPass } = serviceWith({
        passes: [{ ...QUIET, held: 1 }],
        held: [heldRow("proof"), heldRow("pending")],
      });

      await run(service.executePass({ redrive: true }));

      expect(requestPass).toHaveBeenCalledOnce();
    });
  });

  describe("when tenants wait on an operator", () => {
    /** @scenario "Tenants that wait on an operator are never pending" */
    it("tells the scheduled process nothing from a run that advanced nothing", async () => {
      const { service, requestPass } = serviceWith({
        passes: [{ ...QUIET, held: 2, parked: 1 }],
        held: [heldRow("proof")],
      });

      await run(service.executePass({ redrive: true }));

      expect(requestPass).not.toHaveBeenCalled();
    });
  });
});
