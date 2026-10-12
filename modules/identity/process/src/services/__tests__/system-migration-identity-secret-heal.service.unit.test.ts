/**
 * The heal pass repairs users the identifier backfill latched, so it runs on the same cohort.
 * Spec: specs/identity/identity-storage-adapter.feature.
 */
import type { SystemMigration } from "@langwatch/system-migrations";
import { describe, expect, it } from "vitest";

import { MemoryIdentityLatchRepository } from "../../repositories/memory/memory.identity-latch.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { IdentityIdentifierBackfillMigrationService } from "../system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationService } from "../system-migration-identity-secret-heal.service.ts";

const notCalled = async (): Promise<never> => {
  throw new Error("a cohort declaration calls no service");
};

function cohortOf(migration: {
  runsAutomaticallyOnSelfHosted: boolean;
  enrolledAutomatically: boolean;
}) {
  return {
    runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    enrolledAutomatically: migration.enrolledAutomatically,
  };
}

describe("the identity heal pass's cohort", () => {
  /** @scenario "The heal pass runs wherever the identifier backfill latches users" */
  it("runs on self-hosted and enrols every user, exactly as the identifier backfill does", () => {
    const heal = IdentitySecretHealMigrationService.create({
      carryForUser: notCalled,
      findDriftedUserIdsAfter: notCalled,
    });
    const backfill = IdentityIdentifierBackfillMigrationService.create({
      latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
      backfill: { migrateUser: notCalled },
      maxQueuedJobs: 5_000,
    });

    expect(cohortOf(heal)).toEqual({
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
    });
    expect(cohortOf(heal)).toEqual(cohortOf(backfill));
  });
});

describe("the identity heal pass's declaration", () => {
  it("says its migrated users are its steady state, unlike the identifier backfill", () => {
    const heal = IdentitySecretHealMigrationService.create({
      carryForUser: notCalled,
      findDriftedUserIdsAfter: notCalled,
    });
    const backfill: SystemMigration = IdentityIdentifierBackfillMigrationService.create({
      latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
      backfill: { migrateUser: notCalled },
      maxQueuedJobs: 5_000,
    });

    expect(heal.migratedIsSteady).toBe(true);
    expect(backfill.migratedIsSteady).toBeUndefined();
  });
});
