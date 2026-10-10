/**
 * The heal pass repairs users the identifier backfill latched, so it runs on the same cohort.
 * Spec: specs/identity/identity-storage-adapter.feature.
 */
import { describe, expect, it } from "vitest";

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
    const backfill = IdentityIdentifierBackfillMigrationService.create({ migrateUser: notCalled });

    expect(cohortOf(heal)).toEqual({
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
    });
    expect(cohortOf(heal)).toEqual(cohortOf(backfill));
  });
});
