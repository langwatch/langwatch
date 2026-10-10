import type {
  SystemMigration,
  TenantMigrationOutcome,
  TenantSource,
} from "@langwatch/system-migrations";

import type { IdentitySecretCarryService } from "./identity-secret-carry.service.ts";

/** Its own state-table key, separate from the backfill's on purpose — see
 *  the class docblock. Never rename. */
const IDENTITY_SECRET_HEAL_MIGRATION_NAME = "identity-d01-secret-heal" as const;

/**
 * ## Why this is a second migration rather than a step in the first The user this leg exists for is
 * FINALIZED, and `finalized` is terminal: the runner skips a tenant whose record is terminal,
 * The reverse leg of the bridge mirror, as a pass (ADR-116 §4).
 */
export class IdentitySecretHealMigrationService implements SystemMigration {
  readonly name = IDENTITY_SECRET_HEAL_MIGRATION_NAME;
  readonly title = "Sign-in credential repair";
  readonly description =
    "Keeps each member's stored sign-in credentials in step across the two " +
    "places they can be written during the migration, so a password changed " +
    "at any moment keeps working. Sign-in behavior does not change.";
  readonly requiresOperatorConfirmation = false;
  // Runs wherever the identifier backfill it repairs after runs: that backfill
  // latches self-hosted users too, so their secrets can drift there as well.
  readonly runsAutomaticallyOnSelfHosted = true;
  // Enrols every user as that backfill does; only the drifted ones are visited.
  readonly enrolledAutomatically = true;
  /** Only users whose legacy secrets could have drifted (Q64): a pass over the whole
   *  user table costs a claim and two state writes per user, twice before serving. */
  readonly candidateTenants: TenantSource;

  static create(
    secrets: Pick<IdentitySecretCarryService, "carryForUser" | "findDriftedUserIdsAfter">,
  ): IdentitySecretHealMigrationService {
    return new IdentitySecretHealMigrationService(secrets);
  }

  private constructor(
    private readonly secrets: Pick<
      IdentitySecretCarryService,
      "carryForUser" | "findDriftedUserIdsAfter"
    >,
  ) {
    this.candidateTenants = {
      findTenantIdsAfter: (args) => this.secrets.findDriftedUserIdsAfter(args),
    };
  }

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    const outcome = await this.secrets.carryForUser({ userId: tenantId });
    // Deliberately never `finalized`. There is no state in which this user
    // can no longer need repairing — not while both branches can write a
    // secret — so declaring it done would silently stop the pass that keeps
    // their sign-in working.
    return { status: "migrated", report: { kind: "secret_heal", ...outcome } };
  }
}
